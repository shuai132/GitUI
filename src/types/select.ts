export interface SelectOption<T extends string | number = string> {
  value: T
  label: string
  disabled?: boolean
}
