# Plans and limits

**The names and limits below are placeholders until Amit decides the plans and prices.** Only the
limits are enforced. Nothing is billed.

| Plan | Cafés | Active team members (owner included) |
|---|---|---|
| Starter | 1 | 5 |
| Growth | 3 | 20 |
| Multi-café | no limit | no limit |

- A business that signs up starts on **Starter**.
- Businesses that existed before plans (the 400 Coffee pilot) were moved to **Multi-café** by the
  migration. The demo seed uses Multi-café too.
- Adding a café or a team member, or giving a removed team member access back, is refused past the
  limit with "The Starter plan allows 1 café. Contact us to move to a bigger plan." The check locks
  the business while it counts, so two additions at once can't both slip through.
- Features are not gated by plan yet. Inventory, exports and reports work on every plan.
- The owner sees the plan and usage at the top of Setup → Café settings. "Add a new café" is greyed
  out at the limit.

## Changing a business's plan

There is no billing or self-serve upgrade yet, so we change plans:

```sh
pnpm --filter @brew-haven/api plan <business-link> <starter|growth|multi>
```

The plans live in `packages/domain/src/plans.ts`. Changing a limit there takes effect on the next
deploy; nothing is stored per business except the plan id.
