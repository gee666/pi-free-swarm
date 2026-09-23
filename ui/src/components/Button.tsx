import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import styles from "./Button.module.css";
import { Icon } from "./Icon";

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  type?: "button" | "submit";
};

interface ButtonProps extends NativeButtonProps {
  /** Primary is pink-filled: at most one per view region. */
  variant?: "primary" | "secondary";
  /** md: 48px primary / 40px secondary. sm: 36px, to line up with recipient chips. */
  size?: "md" | "sm";
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.button, styles[variant], size === "sm" && styles.small, className)}
      {...rest}
    >
      {icon && <Icon icon={icon} />}
      {children}
    </button>
  );
});

interface IconButtonProps extends NativeButtonProps {
  icon: LucideIcon;
  /** Accessible name; icon buttons have no visible text. */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, className, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} className={cx(styles.iconButton, className)} {...rest}>
      <Icon icon={icon} />
    </button>
  );
});
