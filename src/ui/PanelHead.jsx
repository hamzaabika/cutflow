import React from 'react';

// The kit's panel header: the .panel-head strip (icon + .panel-title) that
// tops the inspector and panel surfaces. Renders the same markup surfaces
// wrote by hand; extra children (actions, badges) slot after the title.
export default function PanelHead({ icon: Icon, title, className = '', children }) {
  return (
    <div className={['panel-head', className].filter(Boolean).join(' ')}>
      {Icon && <Icon size={15} aria-hidden="true" />}
      <span className="panel-title">{title}</span>
      {children}
    </div>
  );
}
