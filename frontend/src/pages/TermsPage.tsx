// pages/TermsPage.tsx
//
// Public terms of use at /terms. Enable Banking asks for this URL when
// registering a production application.

import LegalLayout, { ContactLink, Section } from '../components/LegalLayout'

function TermsPage() {
    return (
        <LegalLayout title="Terms of Use" otherPage={{ to: '/privacy', label: 'Privacy Policy' }}>
            <Section title="About Tidal">
                <p>
                    Tidal is a personal finance tracker built and run by Ginny Thomas as an individual
                    project. By using it you agree to these terms. Questions: <ContactLink />.
                </p>
            </Section>

            <Section title="Not financial advice">
                <p>
                    Tidal helps you record and plan your own money. Nothing in it is financial advice,
                    and it is not a bank, a payment service, or a regulated financial service.
                </p>
            </Section>

            <Section title="Your account">
                <p>
                    Keep your password to yourself; you're responsible for what happens under your
                    account. You must only connect bank accounts that you own or are authorised to access.
                </p>
            </Section>

            <Section title="Bank connections">
                <p>
                    Bank feeds are provided through Enable Banking, which has its own end-user terms you
                    accept when you connect. Access is read-only: Tidal cannot make payments or move
                    money. Banks may change or interrupt access, and consent expires and must be renewed.
                </p>
            </Section>

            <Section title="No guarantees">
                <p>
                    Tidal is provided as is, free of charge, without any warranty. Balances and imported
                    transactions may be incomplete, delayed or wrong, so check important figures against
                    your bank. Tidal may change, be unavailable, or close at any time.
                </p>
            </Section>

            <Section title="Liability">
                <p>
                    To the extent the law allows, Ginny Thomas is not liable for any loss arising from
                    your use of Tidal, including decisions you make based on what it shows. Nothing here
                    limits liability that cannot be limited by law.
                </p>
            </Section>

            <Section title="Ending your use">
                <p>
                    You can stop using Tidal at any time and ask for your account to be deleted by
                    emailing <ContactLink />. Accounts used to misuse the service may be closed.
                </p>
            </Section>

            <Section title="Changes">
                <p>If these terms change, the date at the top will change with them.</p>
            </Section>
        </LegalLayout>
    )
}

export default TermsPage
