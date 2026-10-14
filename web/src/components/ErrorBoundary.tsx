import { Component, type ReactNode } from 'react';

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
      <div className="page">
        <h1>Something broke on this page</h1>
        <p className="muted">{this.state.error.message}</p>
        <button type="button" className="button button-primary" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
