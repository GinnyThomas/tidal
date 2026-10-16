// components/PasswordToggleButton.tsx
//
// The 👁️ / 🔒 show-hide button that sits inside the right edge of a password
// input. The parent must be `relative` so the absolute positioning works.
//
// Why a module-level component? Defining it inside a page's render function
// creates a NEW component type on every render, so React unmounts and
// remounts the button each time instead of updating it.
//
// type="button" is critical — without it, clicking would submit the form.

type Props = {
    show: boolean
    onToggle: () => void
}

function PasswordToggleButton({ show, onToggle }: Props) {
    return (
        <button
            type="button"
            aria-label={show ? 'Hide password' : 'Show password'}
            onClick={onToggle}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
        >
            {show ? '🔒' : '👁️'}
        </button>
    )
}

export default PasswordToggleButton
