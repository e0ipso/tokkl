import { Component, type ReactNode } from 'react';
import { t } from '../i18n/messages.ts';
import { LoadError } from './PageState.tsx';

/**
 * Keeps a crash in one page from blanking the whole app, and offers a way back: Try again runs
 * `onRetry`, such as forgetting a failed page load, and renders the children again, and a new
 * `resetKey` (the next route) clears the error. React reports every
 * caught error to the console itself (createRoot's default onCaughtError), so this adds no logging.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey: string; onRetry?: () => void },
  { error: Error | null }
> {
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
          title={t('shell.pageBroke')}
          message={this.state.error.message}
          onRetry={() => {
            this.props.onRetry?.();
            this.setState({ error: null });
          }}
        />
      </div>
    );
  }
}
