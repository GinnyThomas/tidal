import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PrivacyPage from './PrivacyPage'
import TermsPage from './TermsPage'

describe('PrivacyPage', () => {
    beforeEach(() => {
        render(<MemoryRouter><PrivacyPage /></MemoryRouter>)
    })

    it('shows the privacy policy heading', () => {
        expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument()
    })

    it('names Enable Banking as the bank data provider', () => {
        expect(screen.getAllByText(/enable banking/i).length).toBeGreaterThan(0)
    })

    it('gives a contact email link', () => {
        const links = screen.getAllByRole('link', { name: 'ginnynjon@gmail.com' })
        links.forEach(link => expect(link).toHaveAttribute('href', 'mailto:ginnynjon@gmail.com'))
    })

    it('links to the terms', () => {
        expect(screen.getByRole('link', { name: /terms of use/i })).toHaveAttribute('href', '/terms')
    })
})

describe('TermsPage', () => {
    beforeEach(() => {
        render(<MemoryRouter><TermsPage /></MemoryRouter>)
    })

    it('shows the terms of use heading', () => {
        expect(screen.getByRole('heading', { level: 1, name: /terms of use/i })).toBeInTheDocument()
    })

    it('says Tidal is not financial advice', () => {
        expect(screen.getByText(/not financial advice/i)).toBeInTheDocument()
    })

    it('gives a contact email link', () => {
        const links = screen.getAllByRole('link', { name: 'ginnynjon@gmail.com' })
        links.forEach(link => expect(link).toHaveAttribute('href', 'mailto:ginnynjon@gmail.com'))
    })

    it('links to the privacy policy', () => {
        expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy')
    })
})
