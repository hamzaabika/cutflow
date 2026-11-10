import React from 'react';

// The kit's switch: the one checkbox every surface used to hand-write as
// <input type="checkbox" className="switch">. Renders exactly that element —
// the pill, knob and motion are the .switch rules in styles.css (token-driven
// via --t-switch / --primary / --surface-4). checked, onChange, disabled,
// aria-label and friends pass straight through.
export default function Toggle({ className = '', ...props }) {
  return <input type="checkbox" className={['switch', className].filter(Boolean).join(' ')} {...props} />;
}
