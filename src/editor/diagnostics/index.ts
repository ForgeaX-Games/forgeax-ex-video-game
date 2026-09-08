export { ErrorToastHost } from './ErrorToastHost'
export {
  RenderErrorBoundary,
  type ErrorBoundaryVariant,
  type RenderErrorBoundaryProps,
} from './RenderErrorBoundary'
export {
  clearErrorReports,
  dismissErrorReport,
  formatErrorReportForAi,
  getErrorReports,
  registerDiagnosticContext,
  reportRenderError,
  subscribeErrorReports,
  type DiagnosticContext,
  type ErrorReport,
  type RenderErrorInput,
} from '@/lib/diagnostics/error-report'
