import {FormEvent, useRef, useState} from 'react'
import {Plus} from 'lucide-react'
import type {FieldSchema, ServiceSchema} from '@/types/schema'

interface DynamicFormRendererProps {
    schema: ServiceSchema
    fields?: FieldSchema[]
    initialValues?: Record<string, unknown>
    isSubmitting: boolean
    submitLabel?: string
    pendingLabel?: string
    submitError?: string | null
    onCancel?: () => void
    onSubmit: (values: Record<string, unknown>) => void
}

export function DynamicFormRenderer({
    schema,
    fields,
    initialValues,
    isSubmitting,
    submitLabel = 'Create',
    pendingLabel = 'Creating',
    submitError,
    onCancel,
    onSubmit,
}: DynamicFormRendererProps) {
    const activeFields = fields ?? schema.fields
    const [values, setValues] = useState<Record<string, string>>(() =>
        getInitialFormValues(activeFields, initialValues),
    )
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [readingFiles, setReadingFiles] = useState<Record<string, boolean>>({})
    const fileReads = useRef<Record<string, number>>({})
    const visibleFields = activeFields.filter((field) => isFieldVisible(field, values))
    const readingFile = visibleFields.some((field) => readingFiles[field.name])

    function changeValue(field: FieldSchema, value: string) {
        const nextValues = {...values, [field.name]: value}
        const hiddenFiles = activeFields.filter((candidate) => candidate.type === 'file' && !isFieldVisible(candidate, nextValues))
        for (const hidden of hiddenFiles) {
            nextValues[hidden.name] = ''
            fileReads.current[hidden.name] = (fileReads.current[hidden.name] ?? 0) + 1
        }
        setValues(nextValues)
        setErrors((prev) => {
            const next = {...prev}
            delete next[field.name]
            for (const hidden of hiddenFiles) delete next[hidden.name]
            return next
        })
        setReadingFiles((prev) => ({...prev, ...Object.fromEntries(hiddenFiles.map((hidden) => [hidden.name, false]))}))
    }

    async function readFile(field: FieldSchema, file: File | undefined) {
        const revision = (fileReads.current[field.name] ?? 0) + 1
        fileReads.current[field.name] = revision
        setValues((prev) => ({...prev, [field.name]: ''}))
        setErrors((prev) => {
            const next = {...prev}
            delete next[field.name]
            return next
        })
        setReadingFiles((prev) => ({...prev, [field.name]: Boolean(file)}))
        try {
            if (!file) return
            if (field.maxBytes && file.size > field.maxBytes) {
                throw new Error(`${field.label} must be at most ${field.maxBytes / 1024 / 1024} MiB.`)
            }
            const encoded = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
                reader.onerror = () => reject(new Error(`Could not read ${file.name}. Please select it again.`))
                reader.onabort = () => reject(new Error('File reading was cancelled.'))
                reader.readAsDataURL(file)
            })
            if (fileReads.current[field.name] === revision) {
                setValues((prev) => ({...prev, [field.name]: encoded}))
            }
        } catch (error) {
            if (fileReads.current[field.name] === revision) {
                setErrors((prev) => ({...prev, [field.name]: error instanceof Error ? error.message : 'Could not read file.'}))
            }
        } finally {
            if (fileReads.current[field.name] === revision) {
                setReadingFiles((prev) => ({...prev, [field.name]: false}))
            }
        }
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (readingFile || isSubmitting) return
        const nextErrors = validateValues(visibleFields, values)
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length > 0) return
        onSubmit(values)
    }

    return (
        <form className="dynamic-form" onSubmit={submit} noValidate>
            {visibleFields.map((field, index) => (
                <FieldRow
                    key={field.name}
                    field={field}
                    showGroup={Boolean(field.group && field.group !== visibleFields[index - 1]?.group)}
                    required={isFieldRequired(field, values)}
                    maxLength={fieldMaxLength(field, values).value}
                    value={values[field.name] ?? ''}
                    error={errors[field.name]}
                    onFileChange={(file) => { void readFile(field, file) }}
                    onChange={(value) => changeValue(field, value)}
                />
            ))}
            <div style={{gridColumn: '1 / -1', justifySelf: 'end', display: 'flex', gap: '8px', alignItems: 'center', marginTop: 4}}>
                {onCancel && (
                    <button className="button" type="button" disabled={isSubmitting} onClick={onCancel}>
                        Cancel
                    </button>
                )}
                <button className="button primary" type="submit" disabled={isSubmitting || readingFile}>
                    {submitLabel === 'Create' && <Plus size={14}/>}
                    {readingFile ? 'Reading package' : isSubmitting ? pendingLabel : submitLabel}
                </button>
            </div>
            {submitError && <div className="form-error" role="alert">{submitError}</div>}
        </form>
    )
}

function FieldRow({field, showGroup, required, maxLength, value, error, onChange, onFileChange}: {field: FieldSchema; showGroup: boolean; required: boolean; maxLength?: number; value: string; error?: string; onChange: (value: string) => void; onFileChange: (file: File | undefined) => void}) {
    return (
        <>
            {showGroup && <div className="dynamic-form-group">{field.group}</div>}
            <label className={`dynamic-field${field.span ? ' dynamic-field--span' : ''}`}>
                <span>
                    {field.label}
                    {required && <em className="field-required">*</em>}
                </span>
                <FieldInput field={field} required={required} maxLength={maxLength} value={value} invalid={Boolean(error)} messageId={`${field.name}-message`} onChange={onChange} onFileChange={onFileChange}/>
                {(error || field.description) && (
                    <small id={`${field.name}-message`} className={error ? 'field-error' : undefined}>
                        {error ?? field.description}
                    </small>
                )}
            </label>
        </>
    )
}

function FieldInput({field, required, maxLength, value, invalid, messageId, onChange, onFileChange}: {field: FieldSchema; required: boolean; maxLength?: number; value: string; invalid: boolean; messageId: string; onChange: (value: string) => void; onFileChange: (file: File | undefined) => void}) {
    if (field.type === 'file') {
        return <input type="file" className={`input ${invalid ? 'invalid' : ''}`} accept={field.accept} required={required} aria-invalid={invalid || undefined} aria-describedby={invalid || field.description ? messageId : undefined} onChange={(event) => onFileChange(event.target.files?.[0])}/>
    }
    if (field.type === 'select') {
        return (
            <select className={`input ${invalid ? 'invalid' : ''}`} value={value} required={required} aria-invalid={invalid || undefined} aria-describedby={invalid || field.description ? messageId : undefined} onChange={(event) => onChange(event.target.value)}>
                <option value="">Default</option>
                {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        )
    }

    if (field.type === 'textarea') {
        return (
            <textarea
                className={`textarea code-textarea ${invalid ? 'invalid' : ''}`}
                value={value}
                required={required}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid || field.description ? messageId : undefined}
                minLength={field.validation?.minLength}
                maxLength={maxLength}
                rows={10}
                spellCheck={false}
                onChange={(event) => onChange(event.target.value)}
                placeholder={field.label}
            />
        )
    }

    return (
        <input
            type={field.type === 'password' ? 'password' : 'text'}
            className={`input ${invalid ? 'invalid' : ''}`}
            value={value}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid || field.description ? messageId : undefined}
            minLength={field.validation?.minLength}
            maxLength={maxLength}
            pattern={field.validation?.pattern}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.label}
        />
    )
}

function getInitialFormValues(
    fields: FieldSchema[],
    initialValues?: Record<string, unknown>,
): Record<string, string> {
    const defaults = defaultValues(fields)
    if (initialValues) {
        for (const [key, val] of Object.entries(initialValues)) {
            if (val !== undefined && val !== null) {
                defaults[key] = String(val)
            }
        }
    }
    return defaults
}

function defaultValues(fields: FieldSchema[]): Record<string, string> {
    return Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? '']))
}

function validateValues(fields: FieldSchema[], values: Record<string, string>): Record<string, string> {
    const errors: Record<string, string> = {}

    for (const field of fields) {
        const value = (values[field.name] ?? '').trim()
        if (isFieldRequired(field, values) && !value) {
            errors[field.name] = `${field.label} is required.`
            continue
        }
        if (!value) continue
        if (field.validation?.minLength && value.length < field.validation.minLength) {
            errors[field.name] = field.validation.message ?? `${field.label} is too short.`
            continue
        }
        const maxLength = fieldMaxLength(field, values)
        if (maxLength.value && value.length > maxLength.value) {
            errors[field.name] = maxLength.message ?? `${field.label} is too long.`
            continue
        }
        if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(value)) {
            errors[field.name] = field.validation.message ?? `${field.label} is invalid.`
        }
    }

    return errors
}

function fieldMaxLength(field: FieldSchema, values: Record<string, string>): {value?: number; message?: string} {
    const conditional = field.validation?.maxLengthWhen
    if (conditional && values[conditional.field] === conditional.equals) {
        return {value: conditional.value, message: conditional.message}
    }
    return {value: field.validation?.maxLength, message: field.validation?.message}
}

function isFieldRequired(field: FieldSchema, values: Record<string, string>): boolean {
    if (field.required) return true
    if (!field.requiredWhen) return false
    return values[field.requiredWhen.field] === field.requiredWhen.equals
}

function isFieldVisible(field: FieldSchema, values: Record<string, string>): boolean {
    if (!field.visibleWhen) return true
    if (field.visibleWhen.notEquals !== undefined) return values[field.visibleWhen.field] !== field.visibleWhen.notEquals
    return values[field.visibleWhen.field] === field.visibleWhen.equals
}
