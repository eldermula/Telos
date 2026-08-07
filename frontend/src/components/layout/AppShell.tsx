import {
  LayoutDashboard,
  CandlestickChart,
  Briefcase,
  Bell,
  Settings,
  Link2,
  LogOut,
  BarChart3,
  FileText,
  Shield,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { cn } from '../../lib/cn';
import { BrandLogo } from '../ui/BrandLogo';
import { Button } from '../ui/Button';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  mobilePrimary?: boolean;
  adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true, mobilePrimary: true },
  { to: '/trading', label: 'Trading', icon: CandlestickChart, mobilePrimary: true },
  { to: '/onboarding/broker', label: 'Broker', icon: Link2 },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase, mobilePrimary: true },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/assistant', label: 'Assistant', icon: MessageSquare },
  { to: '/notifications', label: 'Notifications', icon: Bell, mobilePrimary: true },
  { to: '/settings', label: 'Settings', icon: Settings, mobilePrimary: true },
  { to: '/admin', label: 'Admin', icon: Shield, adminOnly: true },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'admin');
  const mobileItems = visibleItems.filter((item) => item.mobilePrimary);

  return (
    <div className="min-h-screen bg-bg-canvas text-text-primary md:flex">
      <aside className="hidden w-[72px] shrink-0 border-r border-border-subtle bg-bg-surface lg:flex lg:w-[260px] lg:flex-col md:flex md:flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-border-subtle px-4 lg:px-6">
          <BrandLogo variant="sidebar-mark" className="h-8 w-8 shrink-0" />
          <span className="type-display-sm hidden text-[1.75rem] text-accent-gold lg:inline">
            Telos
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Primary">
          {visibleItems.map((item) => (
            <ShellNavLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="border-t border-border-subtle p-3">
          <p className="hidden truncate type-caption lg:block">{user?.email}</p>
          <Button
            variant="ghost"
            className="mt-2 w-full justify-start px-2"
            onClick={() => void logout()}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
            <span className="hidden lg:inline">Sign out</span>
          </Button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col pb-20 md:pb-0">
        <header className="flex h-14 items-center justify-between border-b border-border-subtle px-4 md:hidden">
          <div className="flex items-center gap-2">
            <BrandLogo variant="sidebar-mark" className="h-6 w-6" />
            <span className="text-accent-gold type-heading">Telos</span>
          </div>
          <Button variant="ghost" className="px-2" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
            <span className="sr-only">Sign out</span>
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-bg-surface md:hidden"
        aria-label="Mobile"
      >
        {mobileItems.map((item) => (
          <MobileNavLink key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}

function ShellNavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const adminAccent = Boolean(item.adminOnly);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[0.9375rem] transition-colors duration-150',
          isActive
            ? adminAccent
              ? 'border-l-2 bg-glass-fill text-text-primary'
              : 'border-l-2 border-accent-gold bg-glass-fill text-text-primary'
            : 'border-l-2 border-transparent text-text-secondary hover:text-text-primary',
        )
      }
      style={({ isActive }) =>
        isActive && adminAccent ? { borderLeftColor: '#5B7A9C' } : undefined
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
      <span className="hidden lg:inline">{item.label}</span>
    </NavLink>
  );
}

function MobileNavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex flex-1 flex-col items-center gap-1 py-2 type-caption',
          isActive ? 'text-accent-gold' : 'text-text-secondary',
        )
      }
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
      <span>{item.label}</span>
    </NavLink>
  );
}
