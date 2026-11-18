import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode, RefObject } from 'react';
import { CloseIcon } from './icons';
import { Tip } from './Tip';

export interface ModalProps {
  /** What the icon button is called. */
  label: string;
  /** What its tip says, when the name carries more than a tip should. */
  tip?: string;
  title: string;
  /** The button's test id. The modal is `<testId>-modal` and its close button `<testId>-close`. */
  testId: string;
  icon: ReactNode;
  /** A short count shown on the button's corner. */
  badge?: string;
  /** Where the modal mounts, so it inherits the page's theme. */
  container: RefObject<HTMLElement | null>;
  className?: string;
  /** Set both to control it from outside; leave both out and it looks after itself. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  children: ReactNode;
}

/** A button in the footer, an icon or on a phone its name, and the modal it opens over the middle of the page. */
export function Modal(props: ModalProps) {
  const { testId, title } = props;
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Tip label={props.tip ?? props.label} container={props.container}>
        <Dialog.Trigger
          className={`sb-footer-icon ${props.className ?? ''}`}
          data-testid={testId}
          aria-label={props.label}
        >
          {props.icon}
          <span className="sb-footer-word">{props.tip ?? props.label}</span>
          {props.badge && (
            <span className="sb-footer-badge" aria-hidden="true">
              {props.badge}
            </span>
          )}
        </Dialog.Trigger>
      </Tip>
      <Dialog.Portal container={props.container}>
        <Dialog.Backdrop className="sb-modal-backdrop" />
        {/* Closed with the keyboard, focus goes back to the button. Closed with a
            pointer it is left alone, so Space plays instead of reopening this. */}
        <Dialog.Popup
          className="sb-modal"
          data-testid={`${testId}-modal`}
          finalFocus={(closeType) => closeType === 'keyboard'}
        >
          <div className="sb-modal-head">
            <Dialog.Title className="sb-modal-title">{title}</Dialog.Title>
            <Dialog.Close
              className="sb-icon-button"
              data-testid={`${testId}-close`}
              aria-label={`Close ${title.toLowerCase()}`}
            >
              <CloseIcon />
            </Dialog.Close>
          </div>
          <div className="sb-modal-body">{props.children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
