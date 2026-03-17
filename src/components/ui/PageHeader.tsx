interface PageHeaderProps {
  title: string;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
}

export function PageHeader({ title, actions, subtitle }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        <h2 className="page-header-title">{title}</h2>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {subtitle && <div className="page-header-subtitle">{subtitle}</div>}
    </div>
  );
}
