import React, { forwardRef } from 'react';

// The kit's icon-only button: the stylesheet's .icon-btn (30px square, ghost
// until hovered). Same contract as Button — classes come from styles.css,
// every other prop passes through to the <button>.
const IconButton = forwardRef(function IconButton({ className = '', ...props }, ref) {
  return <button ref={ref} className={['icon-btn', className].filter(Boolean).join(' ')} {...props} />;
});

export default IconButton;
