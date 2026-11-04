# Security

If you find a way to take funds, block migrations, or list something false on the site, please tell us privately first.

**Report it by DM to [@LaunchOnIPO](https://x.com/LaunchOnIPO) on X.** Say that it is a security report, and we will arrange how to share the details.

Please include what you found, how to reproduce it, and what it could do. Do not test against real users' coins or funds: the validator tests in `e2e/` run the real programs locally.

## In scope

- The transfer hook in `hk/hook`
- The migration pipeline in `hk/lib` and `api/graduator.mjs`
- The site's API in `api/`

## Out of scope

- Coins launched by other people, and what their creators do
- Meteora's and Pumpfun's own programs: please report those to them
