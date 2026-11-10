import { Component, type ReactNode } from 'react';
import { t } from '../i18n/messages.ts';
import { LoadError } from './PageState.tsx';

/** Try again runs `onRetry` and re-renders; a new `resetKey` clears the error. React already logs caught errors. */
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
