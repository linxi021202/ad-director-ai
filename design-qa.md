# Design QA

## Scope

Adaptive layout and interaction repair for `/generate` and `/projects/[id]`.

## Passed source and test gates

- ProductBrief aspect ratio flows through a shared parser into MediaFrame.
- 9:16, 1:1 and 16:9 resolve to portrait, square and landscape layouts.
- Generated image and video surfaces use `object-fit: contain`.
- Project strategy panel no longer shares the media preview height.
- Shot details render in one portal dialog instead of inside keyframe cards.
- Dialog supports close button, Escape, backdrop click and focus restoration.
- Keyframe actions no longer use `margin-top: auto`.
- `npm run test`: 11 files, 86 tests passed.
- `npm run build`: passed.

## Visual verification

The in-app browser previously rejected the local preview address by policy. Automated screenshots at 1440x900, 1280x800, 1024x768 and 390x844 could not be recaptured without bypassing that policy.

final result: blocked