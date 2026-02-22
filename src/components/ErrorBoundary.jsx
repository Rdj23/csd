import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Use custom fallback if provided
    if (this.props.fallback) {
      return this.props.fallback({
        error: this.state.error,
        reset: this.handleReset,
      });
    }

    const { level = "page" } = this.props;

    if (level === "section") {
      return (
        <div className="flex flex-col items-center justify-center p-6 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl text-center">
          <AlertTriangle className="w-6 h-6 text-red-500 mb-2" />
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            This section failed to load.
          </p>
          <button
            onClick={this.handleReset}
            className="mt-3 px-3 py-1.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      );
    }

    // Full page error (default)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 p-8 text-center">
          <div className="w-14 h-14 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            An unexpected error occurred. Try refreshing the page.
          </p>
          {process.env.NODE_ENV !== "production" && this.state.error && (
            <pre className="text-xs text-left bg-slate-100 dark:bg-slate-800 p-3 rounded-lg mb-4 overflow-auto max-h-32 text-red-600 dark:text-red-400">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3 justify-center">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
