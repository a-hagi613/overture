import { copy } from "../../shared/copy.ts";
import { ReviewApplicationForm } from "./review-application-form.tsx";
import type { ReviewDrawerProps } from "./review-application-form.tsx";
import { SlideOverDrawer } from "./ui/slide-over-drawer.tsx";

/**
 * Opens one Application's questions as a single form, or renders the closed
 * drawer when no Application is active.
 * @param props The active Application group, position, navigation and save callbacks.
 * @param props.count The number of Applications in the current list.
 * @param props.group The active Application and its open questions.
 * @param props.index The active Application's list position.
 * @param props.onClose Closes the form.
 * @param props.onNext Steps to the next Application.
 * @param props.onPrev Steps to the previous Application.
 * @param props.onSaved Runs after a successful save or skip.
 * @returns The Application form drawer.
 */
export function ReviewApplicationDrawer(props: ReviewDrawerProps) {
  const { count, group, index, onClose, onNext, onPrev, onSaved } = props;

  if (group === null) {
    return (
      <SlideOverDrawer
        header={null}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        open={false}
        title={copy.review.drawerAria}
      >
        {null}
      </SlideOverDrawer>
    );
  }

  return (
    <ReviewApplicationForm
      count={count}
      group={group}
      index={index}
      key={group.applicationId}
      onClose={onClose}
      onNext={onNext}
      onPrev={onPrev}
      onSaved={onSaved}
    />
  );
}
