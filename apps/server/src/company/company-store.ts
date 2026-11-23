import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  CompanyConfigSchema,
  EmployeePermissionsSchema,
  EmployeeProfileSchema,
  MemoryPolicySchema,
  ProjectSchema,
  RegisterProjectInputSchema,
  TelegramPolicySchema,
  UpdateFloorplanLayoutInputSchema,
  type CompanyConfig,
  type Department,
  type FloorplanDesk,
  type LoadedEmployee,
  type MemoryPolicy,
  type Project,
  type RegisterProjectInput,
  type TelegramPolicy,
  type UpdateFloorplanLayoutInput,
} from "@virtual-office/shared";
import { atomicWriteFile } from "./atomic-fs.js";
import type { MemoryIndexer } from "./memory-indexer.js";

function slugifyId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `project-${Date.now().toString(36)}`;
}

function detectGitRepository(rootPath: string): { isGitRepo: boolean; defaultBranch?: string } {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: rootPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out !== "true") {
      return { isGitRepo: false };
    }
    let defaultBranch: string | undefined;
    try {
      defaultBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: rootPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      defaultBranch = undefined;
    }
    return { isGitRepo: true, defaultBranch };
  } catch {
    return { isGitRepo: fs.existsSync(path.join(rootPath, ".git")) };
  }
}

/**
 * Single Source of Truth (SSOT) loader and watcher for `company/` Markdown, YAML, and JSON files.
 */
export class CompanyStore {
  private companyConfig!: CompanyConfig;
  private employees = new Map<string, LoadedEmployee>();
  private projects = new Map<string, Project>();
  private watcher: FSWatcher | null = null;

  constructor(
    public readonly companyRoot: string,
    private readonly memoryIndexer?: MemoryIndexer,
  ) {
    this.reloadAll();
  }

  public reloadAll(): void {
    this.loadCompanyConfig();
    this.loadEmployees();
    this.loadProjects();
    this.memoryIndexer?.syncAll();
  }

  private loadCompanyConfig(): void {
    const configPath = path.join(this.companyRoot, "company.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    this.companyConfig = CompanyConfigSchema.parse(raw);
  }

  private loadEmployees(): void {
    const next = new Map<string, LoadedEmployee>();
    const employeesDir = path.join(this.companyRoot, "employees");
    if (fs.existsSync(employeesDir)) {
      for (const entry of fs.readdirSync(employeesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const empDir = path.join(employeesDir, entry.name);
        const profilePath = path.join(empDir, "profile.yaml");
        const permissionsPath = path.join(empDir, "permissions.json");
        if (!fs.existsSync(profilePath) || !fs.existsSync(permissionsPath)) {
          continue;
        }

        const profile = EmployeeProfileSchema.parse(
          parseYaml(fs.readFileSync(profilePath, "utf8")),
        );
        const permissions = EmployeePermissionsSchema.parse(
          JSON.parse(fs.readFileSync(permissionsPath, "utf8")),
        );
        const systemPath = path.join(empDir, "system.md");
        const systemPrompt = fs.existsSync(systemPath)
          ? fs.readFileSync(systemPath, "utf8").trim()
          : "";

        const skillsDir = path.join(empDir, "skills");
        const skills: LoadedEmployee["skills"] = [];
        if (fs.existsSync(skillsDir)) {
          for (const skillFile of fs.readdirSync(skillsDir).sort()) {
            if (!skillFile.toLowerCase().endsWith(".md")) {
              continue;
            }
            const fullSkillPath = path.join(skillsDir, skillFile);
            skills.push({
              name: path.basename(skillFile, ".md"),
              content: fs.readFileSync(fullSkillPath, "utf8").trim(),
              filePath: fullSkillPath,
            });
          }
        }

        next.set(profile.id, {
          profile,
          permissions,
          systemPrompt,
          skills,
          rootDir: empDir,
        });
      }
    }
    this.employees = next;
  }

  private loadProjects(): void {
    const next = new Map<string, Project>();
    const projectsDir = path.join(this.companyRoot, "projects");
    if (fs.existsSync(projectsDir)) {
      for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const projectFile = path.join(projectsDir, entry.name, "project.yaml");
        if (!fs.existsSync(projectFile)) {
          continue;
        }
        const project = ProjectSchema.parse(parseYaml(fs.readFileSync(projectFile, "utf8")));
        next.set(project.id, project);
      }
    }
    this.projects = next;
  }

  public getCompanyConfig(): CompanyConfig {
    return this.companyConfig;
  }

  public listEmployees(): LoadedEmployee[] {
    return Array.from(this.employees.values());
  }

  public getEmployee(id: string): LoadedEmployee | null {
    return this.employees.get(id) ?? null;
  }

  public listProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  public getProject(id: string): Project | null {
    return this.projects.get(id) ?? null;
  }

  public registerProject(rawInput: RegisterProjectInput): Project {
    const input = RegisterProjectInputSchema.parse(rawInput);
    const resolvedRoot = path.resolve(input.rootPath);
    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
      throw new Error(`Project root directory does not exist: ${resolvedRoot}`);
    }

    const baseId = input.id ? slugifyId(input.id) : slugifyId(input.name);
    let projectId = baseId;
    let suffix = 2;
    while (this.projects.has(projectId)) {
      projectId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const gitInfo = detectGitRepository(resolvedRoot);
    const project: Project = {
      id: projectId,
      name: input.name,
      rootPath: fs.realpathSync.native(resolvedRoot),
      isGitRepo: gitInfo.isGitRepo,
      defaultBranch: gitInfo.defaultBranch,
      description: input.description ?? "",
      assignedEmployeeIds: input.assignedEmployeeIds ?? "*",
      dailyBudgetUsd: input.dailyBudgetUsd ?? 15.0,
      createdAt: new Date().toISOString(),
    };

    const projectMetaDir = path.join(this.companyRoot, "projects", project.id);
    fs.mkdirSync(path.join(projectMetaDir, "memory"), { recursive: true });
    atomicWriteFile(path.join(projectMetaDir, "project.yaml"), stringifyYaml(project));

    this.projects.set(project.id, project);
    return project;
  }

  public removeProject(id: string): boolean {
    if (!this.projects.has(id)) {
      return false;
    }
    const projectMetaDir = path.join(this.companyRoot, "projects", id);
    if (fs.existsSync(projectMetaDir)) {
      fs.rmSync(projectMetaDir, { recursive: true, force: true });
    }
    this.projects.delete(id);
    this.memoryIndexer?.syncAll();
    return true;
  }

  public updateCompanyPolicies(patch: {
    budgets?: Partial<CompanyConfig["budgets"]>;
    security?: Partial<NonNullable<CompanyConfig["security"]>>;
    memory?: Partial<MemoryPolicy>;
    telegram?: Partial<TelegramPolicy>;
  }): CompanyConfig {
    const baseMemory = this.companyConfig.memory ?? MemoryPolicySchema.parse({});
    const baseTelegram = this.companyConfig.telegram ?? TelegramPolicySchema.parse({});
    const nextRaw: CompanyConfig = {
      ...this.companyConfig,
      budgets: patch.budgets
        ? { ...this.companyConfig.budgets, ...patch.budgets }
        : this.companyConfig.budgets,
      security: patch.security
        ? {
            enabled: this.companyConfig.security?.enabled ?? true,
            domainAllowlist: this.companyConfig.security?.domainAllowlist ?? [
              "github.com",
              "api.github.com",
              "docs.github.com",
              "npmjs.com",
              "developer.mozilla.org",
            ],
            maxResponseBytes: this.companyConfig.security?.maxResponseBytes ?? 262_144,
            ...patch.security,
          }
        : this.companyConfig.security,
      memory: patch.memory
        ? MemoryPolicySchema.parse({ ...baseMemory, ...patch.memory })
        : this.companyConfig.memory,
      telegram: patch.telegram
        ? TelegramPolicySchema.parse({ ...baseTelegram, ...patch.telegram })
        : this.companyConfig.telegram,
    };
    const validated = CompanyConfigSchema.parse(nextRaw);
    atomicWriteFile(
      path.join(this.companyRoot, "company.json"),
      JSON.stringify(validated, null, 2),
    );
    this.companyConfig = validated;
    return validated;
  }

  /**
   * Computes the next non-overlapping desk coordinates inside the `workstations` zone.
   */
  public allocateFloorplanDesk(employeeId: string): FloorplanDesk {
    const existingDesks = this.companyConfig.floorplan.desks;
    const rows = [130, 310];

    for (let colIdx = 0; colIdx < 20; colIdx += 1) {
      const x = 500 + colIdx * 260;
      for (const y of rows) {
        const collides = existingDesks.some(
          (d) => Math.abs(d.x - x) < 200 && Math.abs(d.y - y) < 120,
        );
        if (!collides) {
          return {
            id: `desk-${employeeId}`,
            zoneId: "workstations",
            x,
            y,
            employeeId,
          };
        }
      }
    }

    return {
      id: `desk-${employeeId}`,
      zoneId: "workstations",
      x: 500 + existingDesks.length * 260,
      y: 130,
      employeeId,
    };
  }

  public addEmployeeDesk(desk: FloorplanDesk, departmentMeta?: Department): CompanyConfig {
    const filteredDesks = this.companyConfig.floorplan.desks.filter(
      (d) => d.employeeId !== desk.employeeId && d.id !== desk.id,
    );
    const collides = filteredDesks.some(
      (d) => Math.abs(d.x - desk.x) < 200 && Math.abs(d.y - desk.y) < 120,
    );
    const finalDesk = collides ? this.allocateFloorplanDesk(desk.employeeId ?? desk.id) : desk;
    const nextDesks = [...filteredDesks, finalDesk];

    const departments = [...this.companyConfig.departments];
    if (departmentMeta && !departments.some((d) => d.id === departmentMeta.id)) {
      departments.push(departmentMeta);
    }

    const updated = this.recomputeFloorplanDimensions({
      ...this.companyConfig,
      departments,
      floorplan: {
        ...this.companyConfig.floorplan,
        desks: nextDesks,
      },
    });

    const validated = CompanyConfigSchema.parse(updated);
    atomicWriteFile(
      path.join(this.companyRoot, "company.json"),
      JSON.stringify(validated, null, 2),
    );
    this.companyConfig = validated;
    return validated;
  }

  public removeEmployeeDesk(employeeId: string): CompanyConfig {
    const nextDesks = this.companyConfig.floorplan.desks.filter(
      (d) => d.employeeId !== employeeId && d.id !== `desk-${employeeId}`,
    );
    const updated = this.recomputeFloorplanDimensions({
      ...this.companyConfig,
      floorplan: {
        ...this.companyConfig.floorplan,
        desks: nextDesks,
      },
    });
    const validated = CompanyConfigSchema.parse(updated);
    atomicWriteFile(
      path.join(this.companyRoot, "company.json"),
      JSON.stringify(validated, null, 2),
    );
    this.companyConfig = validated;
    return validated;
  }

  private recomputeFloorplanDimensions(cfg: CompanyConfig): CompanyConfig {
    const wsDesks = cfg.floorplan.desks.filter((d) => d.zoneId === "workstations");
    const maxDeskRight = wsDesks.reduce((max, d) => Math.max(max, d.x + 240), 1160);
    const nextZones = cfg.floorplan.zones.map((zone) => {
      if (zone.id === "workstations" || zone.id === "lounge") {
        const minRight = Math.max(zone.x + 740, maxDeskRight);
        return { ...zone, width: minRight - zone.x };
      }
      return zone;
    });
    const maxZoneRight = nextZones.reduce((max, z) => Math.max(max, z.x + z.width), 1160);
    return {
      ...cfg,
      floorplan: {
        ...cfg.floorplan,
        width: Math.max(1200, maxZoneRight + 40),
        zones: nextZones,
      },
    };
  }

  public updateFloorplanLayout(rawInput: UpdateFloorplanLayoutInput): CompanyConfig {
    const input = UpdateFloorplanLayoutInputSchema.parse(rawInput);
    const nextWidth = input.width ?? this.companyConfig.floorplan.width;
    const nextHeight = input.height ?? this.companyConfig.floorplan.height;
    const nextTheme = input.theme ?? this.companyConfig.floorplan.theme;
    const nextDepartments = input.departments ?? this.companyConfig.departments;
    const nextZones = input.zones ?? this.companyConfig.floorplan.zones;
    const nextDesks = input.desks ?? this.companyConfig.floorplan.desks;

    const assertUniqueIds = (items: Array<{ id: string }>, kind: string): void => {
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.id)) {
          throw new Error(`Duplicate ${kind} ID "${item.id}" in floorplan layout.`);
        }
        seen.add(item.id);
      }
    };

    assertUniqueIds(nextDepartments, "department");
    assertUniqueIds(nextZones, "zone");
    assertUniqueIds(nextDesks, "desk");

    for (const zone of nextZones) {
      if (
        zone.x < 14 ||
        zone.y < 14 ||
        zone.x + zone.width > nextWidth - 14 ||
        zone.y + zone.height > nextHeight - 14
      ) {
        throw new Error(
          `Zone "${zone.id}" exceeds canvas bounds (${nextWidth}x${nextHeight}).`,
        );
      }
    }

    for (let i = 0; i < nextDesks.length; i += 1) {
      const a = nextDesks[i]!;
      if (a.x < 30 || a.y < 30 || a.x + 220 > nextWidth || a.y + 120 > nextHeight) {
        throw new Error(
          `Desk "${a.id}" at (${a.x}, ${a.y}) exceeds canvas bounds (${nextWidth}x${nextHeight}).`,
        );
      }
      for (let j = i + 1; j < nextDesks.length; j += 1) {
        const b = nextDesks[j]!;
        if (Math.abs(a.x - b.x) < 180 && Math.abs(a.y - b.y) < 100) {
          throw new Error(
            `Desks "${a.id}" and "${b.id}" overlap vertically/horizontally (min clearance 180x100).`,
          );
        }
      }
    }

    const updated = CompanyConfigSchema.parse({
      ...this.companyConfig,
      departments: nextDepartments,
      floorplan: {
        width: nextWidth,
        height: nextHeight,
        theme: nextTheme,
        zones: nextZones,
        desks: nextDesks,
      },
    });

    atomicWriteFile(
      path.join(this.companyRoot, "company.json"),
      JSON.stringify(updated, null, 2),
    );
    this.companyConfig = updated;
    return updated;
  }

  public startWatching(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = chokidar.watch(this.companyRoot, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
      ignored: [/\.tmp\./, /fixtures/, /(^|[\\/])\.git([\\/]|$)/],
    });

    const handleChange = (changedPath: string): void => {
      const normalized = changedPath.replace(/\\/g, "/");
      try {
        if (normalized.endsWith("/company.json")) {
          this.loadCompanyConfig();
        } else if (normalized.includes("/employees/") && !normalized.includes("/memory/")) {
          this.loadEmployees();
        } else if (normalized.includes("/projects/") && normalized.endsWith("/project.yaml")) {
          this.loadProjects();
        } else if (normalized.endsWith(".md") && normalized.includes("/memory/")) {
          this.memoryIndexer?.indexSingleFile(changedPath);
        }
      } catch {
        // Ignore transient invalid file state during manual edits; next valid save reloads cleanly
      }
    };

    this.watcher.on("add", handleChange);
    this.watcher.on("change", handleChange);
    this.watcher.on("unlink", (removedPath) => {
      const normalized = removedPath.replace(/\\/g, "/");
      if (normalized.endsWith(".md") && normalized.includes("/memory/")) {
        this.memoryIndexer?.indexSingleFile(removedPath);
      } else if (normalized.includes("/employees/") || normalized.includes("/projects/")) {
        this.reloadAll();
      }
    });
  }

  public async stopWatching(): Promise<void> {
    if (!this.watcher) {
      return;
    }
    await this.watcher.close();
    this.watcher = null;
  }
}
