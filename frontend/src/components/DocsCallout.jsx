const ICONS = {
  info: 'i',
  note: '›',
  tip: '✦',
  warn: '!',
  danger: '✕',
  success: '✓',
};

export default function DocsCallout({ type = 'info', title, children }) {
  const variant = ICONS[type] ? type : 'info';
  return (
    <div className={`docsCallout docsCallout-${variant}`}>
      <span className="docsCalloutIcon" aria-hidden="true">
        {ICONS[variant]}
      </span>
      <div className="docsCalloutBody">
        {title ? <p className="docsCalloutTitle">{title}</p> : null}
        <div className="docsCalloutText">{children}</div>
      </div>
    </div>
  );
}
