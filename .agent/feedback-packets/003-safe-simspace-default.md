# Safe SimSpace Default

Status: active

## Feedback

Use `validate` and `simspace run` as the default app validation path.

## Reason

SimSpace stages apps into disposable run folders so scenarios do not mutate the real app tree by default.

## Boundary

`scenario run` remains available, but it is raw/direct and should be used only when touching the attached source path is intentional.
