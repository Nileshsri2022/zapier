import React from 'react'

const FormInput = ({label, name, onChange, placeholder}: {
    label: string,
    name: string,
    onChange: (e: any) => void,
    placeholder?: string
}) => {
  return (
    <div className='flex flex-col gap-2'>
        <label htmlFor={name} className='font-semibold'>{label}</label>
        <input id={name} name={name} type={label === "Password" ? 'password': 'text'} placeholder={placeholder} className='border border-gray-400 rounded-sm px-3 py-2 bg-base-100 text-black' onChange={onChange} />
    </div>
  )
}

export default FormInput
