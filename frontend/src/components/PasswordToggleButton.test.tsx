import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import PasswordToggleButton from './PasswordToggleButton'

describe('PasswordToggleButton', () => {
    it('offers to show the password while it is hidden', () => {
        render(<PasswordToggleButton show={false} onToggle={() => {}} />)
        expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
    })

    it('offers to hide the password while it is visible', () => {
        render(<PasswordToggleButton show={true} onToggle={() => {}} />)
        expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
    })

    it('calls onToggle when clicked', async () => {
        const onToggle = vi.fn()
        render(<PasswordToggleButton show={false} onToggle={onToggle} />)
        await userEvent.click(screen.getByRole('button'))
        expect(onToggle).toHaveBeenCalledOnce()
    })

    it('is type="button" so clicking it never submits the surrounding form', () => {
        render(<PasswordToggleButton show={false} onToggle={() => {}} />)
        expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
    })
})
