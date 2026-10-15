import { Component, type ReactNode } from 'react';
import { LoadError } from './PageState.tsx';

/** Keeps a crash in one page from blanking the whole app, and offers a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page error-page">
        <LoadError
          title="Something broke on this page"
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    );
  }
}
