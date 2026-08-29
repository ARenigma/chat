import Link from 'next/link';

interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="page-header-breadcrumb" aria-label="Breadcrumb">
          {breadcrumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              {i > 0 && <span aria-hidden="true" style={{ color: 'var(--border-hairline)' }}>›</span>}
              {c.href ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div style={{ display: 'flex', gap: '0.625rem', flexShrink: 0 }}>{actions}</div>}
      </div>
    </div>
  );
}
