// components/CsvMappingForm.test.tsx

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CsvMappingForm from './CsvMappingForm'

const HEADERS = ['Date', 'Amount', 'Merchant', 'Ref', 'Notes']

const SAMPLE_ROWS = [
  { Date: '15/01/2026', Amount: '-42.50', Merchant: 'Tesco', Ref: 'REF001', Notes: 'groceries' },
  { Date: '16/01/2026', Amount: '-10.00', Merchant: 'Starbucks', Ref: 'REF002', Notes: '' },
  { Date: '17/01/2026', Amount: '1200.00', Merchant: 'Employer', Ref: 'REF003', Notes: 'salary' },
]

describe('CsvMappingForm', () => {
  it('renders all header columns in the dropdowns', () => {
    render(
      <CsvMappingForm
        headers={HEADERS}
        sampleRows={SAMPLE_ROWS}
        accountName="Barclays"
        onSave={vi.fn()}
      />,
    )
    // Date column dropdown should have the header options
    const selects = screen.getAllByRole('combobox')
    const dateSelect = selects[0]
    HEADERS.forEach(h => {
      expect(dateSelect.innerHTML).toContain(h)
    })
  })

  it('shows preview rows', () => {
    render(
      <CsvMappingForm
        headers={HEADERS}
        sampleRows={SAMPLE_ROWS}
        accountName="Barclays"
        onSave={vi.fn()}
      />,
    )
    // Preview table should be present
    expect(screen.getByText('Preview (first 3 rows)')).toBeInTheDocument()
  })

  it('shows save checkbox with account name', () => {
    render(
      <CsvMappingForm
        headers={HEADERS}
        sampleRows={SAMPLE_ROWS}
        accountName="My Barclays"
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByText(/Save this mapping for My Barclays/)).toBeInTheDocument()
  })

  it('calls onSave with config and saveForAccount=true when submitted', () => {
    const onSave = vi.fn()
    render(
      <CsvMappingForm
        headers={HEADERS}
        sampleRows={SAMPLE_ROWS}
        accountName="Barclays"
        onSave={onSave}
      />,
    )
    // The form should be valid (DD/MM/YYYY + first columns selected by default)
    const btn = screen.getByRole('button', { name: /Save & Continue/i })
    fireEvent.click(btn)
    expect(onSave).toHaveBeenCalledOnce()
    const [config, save] = onSave.mock.calls[0]
    expect(save).toBe(true)
    expect(config).toHaveProperty('dateColumn')
    expect(config).toHaveProperty('amountColumn')
  })

  it('unchecking the save checkbox passes saveForAccount=false', () => {
    const onSave = vi.fn()
    render(
      <CsvMappingForm
        headers={HEADERS}
        sampleRows={SAMPLE_ROWS}
        accountName="Barclays"
        onSave={onSave}
      />,
    )
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox) // uncheck
    fireEvent.click(screen.getByRole('button', { name: /Save & Continue/i }))
    expect(onSave.mock.calls[0][1]).toBe(false)
  })

  it('shows debit/credit column selects when debit_credit mode chosen', () => {
    render(
      <CsvMappingForm
        headers={HEADERS}
        sampleRows={SAMPLE_ROWS}
        accountName="Virgin"
        onSave={vi.fn()}
      />,
    )
    const radios = screen.getAllByRole('radio')
    // Second radio = debit_credit
    fireEvent.click(radios[1])
    expect(screen.getByText(/Debit column/)).toBeInTheDocument()
    expect(screen.getByText(/Credit column/)).toBeInTheDocument()
  })
})
