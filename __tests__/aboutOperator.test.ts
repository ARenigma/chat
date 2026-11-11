import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const about = readFileSync(join(__dirname, '..', 'src/screens/AboutScreen.tsx'), 'utf8');

describe('About names the operator', () => {
  it('shows the company name the website and the Play profile use', () => {
    expect(about).toContain("'Axionix Technologies Private Limited'");
    expect(about).toContain('Pappal is operated by ${OPERATOR_NAME}.');
    expect(about).toContain('testID="about-operator"');
  });

  it('offers the support email as a tappable link', () => {
    expect(about).toContain("'hello@pappal.live'");
    expect(about).toContain('Linking.openURL(`mailto:${SUPPORT_EMAIL}`)');
    expect(about).toContain('testID="about-support-email"');
  });
});
