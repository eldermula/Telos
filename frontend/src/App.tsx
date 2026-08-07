import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { GuestRoute, ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { BotEventsProvider } from './realtime/BotEventsProvider';
import {
  LoginPage,
  PasswordResetPage,
  SignupPage,
} from './pages/auth/AuthPages';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { UiShowcasePage } from './pages/dev/UiShowcasePage';
import { AnalyticsPage } from './pages/analytics/AnalyticsPage';
import { BrokerOnboardingPage } from './pages/onboarding/BrokerOnboardingPage';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { PortfolioPage } from './pages/portfolio/PortfolioPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { TradingPage } from './pages/trading/TradingPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BotEventsProvider>
          <Routes>
            <Route path="/dev/ui" element={<UiShowcasePage />} />

            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/password-reset" element={<PasswordResetPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/trading" element={<TradingPage />} />
                <Route path="/onboarding/broker" element={<BrokerOnboardingPage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BotEventsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
