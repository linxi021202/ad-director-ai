import Link from "next/link";
import type { ReactNode } from "react";

type HeaderActionButtonProps = {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
};

export function HeaderActionButton({ children, className = "", onClick, href }: HeaderActionButtonProps) {
  const classes = `workspace-header-action ${className}`.trim();
  return href
    ? <Link href={href} className={classes}>{children}</Link>
    : <button type="button" className={classes} onClick={onClick}>{children}</button>;
}
