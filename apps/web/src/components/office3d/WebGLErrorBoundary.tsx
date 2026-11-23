import { AlertTriangle } from "lucide-react";
import { Component, type ReactNode } from "react";
import type { Locale } from "../../i18n/translations.ts";

interface WebGLErrorBoundaryProps {
  locale: Locale;
  onFallbackTo2D: () => void;
  children: ReactNode;
}

interface WebGLErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class WebGLErrorBoundary extends Component<
  WebGLErrorBoundaryProps,
  WebGLErrorBoundaryState
> {
  state: WebGLErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): WebGLErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "WebGL initialization failed",
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const { locale, onFallbackTo2D } = this.props;
    return (
      <div className="h-[540px] flex flex-col items-center justify-center p-6 text-center bg-studio-ground/50 space-y-3">
        <AlertTriangle className="w-8 h-8 text-studio-amber" />
        <h3 className="text-[14px] font-semibold text-studio-ink">
          {locale === "ar"
            ? "تعذّر تهيئة المشهد ثلاثي الأبعاد (WebGL)"
            : "Unable to initialize 3D WebGL viewport"}
        </h3>
        <p className="text-[12px] text-studio-muted max-w-md">{this.state.message}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="h-8 px-3 rounded border border-studio-border bg-studio-surface text-studio-ink text-[12px] font-medium hover:border-studio-accent"
          >
            {locale === "ar" ? "إعادة المحاولة" : "Retry 3D"}
          </button>
          <button
            type="button"
            onClick={onFallbackTo2D}
            className="h-8 px-3 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-medium"
          >
            {locale === "ar" ? "العودة للمخطط 2D" : "Switch to 2D Blueprint"}
          </button>
        </div>
      </div>
    );
  }
}
