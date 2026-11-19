import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[UI] Unhandled render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mp-fatal-error" role="alert">
        <div className="mp-fatal-error-card">
          <div className="mp-eyebrow">Dashboard error</div>
          <h1>Something went wrong</h1>
          <p>
            The dashboard hit an unexpected error. Your data is safe. Reload the page, or reset the view if the
            problem continues.
          </p>
          <pre>{this.state.error.message}</pre>
          <div className="mp-fatal-error-actions">
            <button type="button" className="mp-btn mp-btn-primary" onClick={() => window.location.reload()}>
              Reload dashboard
            </button>
            <button
              type="button"
              className="mp-btn mp-btn-ghost"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Back to overview
            </button>
          </div>
        </div>
      </div>
    );
  }
}
