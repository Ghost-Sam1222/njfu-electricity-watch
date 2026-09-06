# Security Notes

This repository is intended to stay private.

Never commit or publish:

- `SYNJONES_AUTH` or any CAS login token
- `BARK_URL` or Bark device key
- Clash/Mihomo subscriptions
- Clash/Mihomo YAML configs with proxy nodes
- GitHub Actions logs copied with unmasked secrets

Proxy subscription URLs and generated Clash/Mihomo configs may contain paid service credentials. Store them only in GitHub Actions Secrets, such as `CLASH_CONFIG_YAML` or `CLASH_SUBSCRIPTION_URL`.

Do not enable public GitHub Pages from this repository unless all private configs, tokens, dorm identifiers, and generated history data have been reviewed and separated from the public site.
