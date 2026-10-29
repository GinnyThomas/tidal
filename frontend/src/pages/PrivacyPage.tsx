// pages/PrivacyPage.tsx
//
// Public privacy policy at /privacy. Enable Banking asks for this URL when
// registering a production application. Keep it in step with what the app
// actually stores: if a model or third-party service changes, update here.

import LegalLayout, { ContactLink, Section } from '../components/LegalLayout'

function PrivacyPage() {
    return (
        <LegalLayout title="Privacy Policy" otherPage={{ to: '/terms', label: 'Terms of Use' }}>
            <Section title="Who runs Tidal">
                <p>
                    Tidal is a personal finance tracker built and run by Ginny Thomas as an individual,
                    not a company. For anything about your data, email <ContactLink />.
                </p>
            </Section>

            <Section title="What Tidal stores">
                <ul className="list-disc pl-6 space-y-1">
                    <li>Your email address and a hashed password (the password itself is never stored).</li>
                    <li>
                        The finance data you enter or import: accounts, categories, transactions, budgets,
                        schedules, promotions and opening balances.
                    </li>
                    <li>
                        If you connect a bank: the bank's name, a session reference for your consent, its
                        expiry date, account names and currencies, the last four digits of each account
                        number, and the transactions you sync.
                    </li>
                    <li>A one-time password reset token, stored hashed, which expires after 30 minutes.</li>
                </ul>
                <p>
                    Tidal has no ads, no analytics and no tracking cookies. Your browser keeps your login
                    token and a few display preferences in its local storage.
                </p>
            </Section>

            <Section title="Bank connections">
                <p>
                    Bank feeds use Enable Banking, a licensed account information service provider. You
                    approve read-only access at your own bank. Tidal never sees your bank login details
                    and cannot move money. Tidal reads account details and transactions only for the
                    accounts you approve, and only while your consent is valid. You can withdraw it at
                    any time by removing the connection in Tidal or through your bank.
                </p>
            </Section>

            <Section title="How your data is used">
                <p>
                    Only to run Tidal for you: showing your balances, plans and reports, importing
                    transactions, and sending password reset emails. Your data is never sold, shared for
                    marketing, or used to train AI models.
                </p>
            </Section>

            <Section title="Services that process your data">
                <ul className="list-disc pl-6 space-y-1">
                    <li>Supabase: database hosting.</li>
                    <li>Railway: hosting for the Tidal server.</li>
                    <li>Vercel: hosting for the Tidal website.</li>
                    <li>Resend: sending password reset emails.</li>
                    <li>Enable Banking: bank connections, if you use them.</li>
                </ul>
            </Section>

            <Section title="How long data is kept">
                <p>
                    Until you ask for your account to be deleted. Removing a bank connection deletes its
                    stored consent and account details; transactions already imported stay in your
                    Tidal account until you delete them.
                </p>
            </Section>

            <Section title="Your rights">
                <p>
                    You can ask for a copy of your data, for it to be corrected, or for your account and
                    all its data to be deleted. Email <ContactLink /> and it will be done within 30 days.
                    If you're in the UK or EU, you can also complain to your data protection authority
                    (the ICO in the UK, the AEPD in Spain).
                </p>
            </Section>

            <Section title="Changes">
                <p>If this policy changes, the date at the top will change with it.</p>
            </Section>
        </LegalLayout>
    )
}

export default PrivacyPage
