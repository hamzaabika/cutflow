import React, { forwardRef } from 'react';

// The kit's button: renders the stylesheet's .btn family exactly as surfaces
// have always written it by hand (class names, geometry and states live in
// styles.css and are driven by the design tokens). variant: primary | danger |
// ghost | export; size: 'sm'; block stretches full width. All other props
// (onClick, disabled, aria-*, title…) pass straight to the <button>.
const VARIANTS = { primary: 'btn-primary', danger: 'btn-danger', ghost: 'btn-ghost', export: 'btn-export' };

const Button = forwardRef(function Button({ variant, size, block, className = '', ...props }, ref) {
  const cls = ['btn', VARIANTS[variant] || '', size === 'sm' ? 'btn-sm' : '', block ? 'btn-block' : '', className]
    .filter(Boolean).join(' ');
  return <button ref={ref} className={cls} {...props} />;
});

export default Button;
