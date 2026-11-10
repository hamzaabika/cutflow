import React from 'react';

// The kit's card: the stylesheet's .card surface (token radius/elevation,
// .card-row / .card-icon companions in styles.css). A plain wrapper — layout
// inside stays the caller's, exactly as hand-written .card divs behaved.
export default function Card({ className = '', children, ...props }) {
  return <div className={['card', className].filter(Boolean).join(' ')} {...props}>{children}</div>;
}
