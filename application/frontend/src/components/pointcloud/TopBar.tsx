import { Calendar, PanelRight, Settings } from 'lucide-react'
import { HUD_SURFACE } from './ui'

/**
 * Header cluster of the Point Cloud View: brand, File/View/Edit/… menu, Invite,
 * utility buttons, profile and settings, plus the model-type selector and the
 * "Overall Analytics" strip. Visual placeholders only — no menus, auth or
 * view switching yet.
 */

function BrandLogo() {
  return (
    <svg viewBox="0 0 46 40" className="h-[40px] w-[46px]" fill="none" aria-hidden>
      <circle cx="23" cy="20" r="17.3" stroke="#fff" strokeWidth="5" />
      {/* orbit swoosh cutting across the ring */}
      <path d="M3 34 L43 7" stroke="#000" strokeWidth="7.8" strokeLinecap="round" />
      <path d="M3 34 L43 7" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
      {/* inner "S" */}
      <path
        d="M30 13 C21 10.5 13 15 19.5 19.5 C26 23.5 22 29.5 12.5 27"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

const MENU = [
  { label: 'File', className: 'w-[74px] pl-[13px]' },
  { label: 'View', className: 'w-[72px]' },
  { label: 'Edit', className: 'w-[64px]' },
  { label: 'Add', className: 'w-[62px]' },
  { label: 'Tools', className: 'w-[72px]' },
  { label: 'Help', className: 'w-[80px] pr-[13px]' },
]

function MenuBar() {
  return (
    <nav
      aria-label="Application menu"
      className={`${HUD_SURFACE} pointer-events-auto absolute left-[196px] top-[17px] flex h-[30px] w-[424px] items-center`}
    >
      {MENU.map((item, index) => (
        <span
          key={item.label}
          className={`flex h-[25px] items-center justify-center pt-[3px] font-jersey25 text-[14px] leading-[14px] text-white ${item.className} ${
            index > 0 ? 'border-l border-[rgba(150,150,150,0.29)]' : ''
          }`}
        >
          {item.label}
        </span>
      ))}
    </nav>
  )
}

function Avatar() {
  return (
    <svg viewBox="0 0 25 25" className="h-[25px] w-[25px] rounded-[5px]" aria-hidden>
      <rect width="25" height="25" fill="#4b5a52" />
      <circle cx="12.5" cy="10" r="4.6" fill="#c9b8a6" />
      <path d="M3 25 C3 17.5 8 15.5 12.5 15.5 C17 15.5 22 17.5 22 25 Z" fill="#2f3b35" />
      <path d="M7.6 9 C7.6 4 17.4 4 17.4 9 C15 6.8 10 6.8 7.6 9 Z" fill="#7fae6b" />
    </svg>
  )
}

function ProfileChip() {
  return (
    <div className={`${HUD_SURFACE} relative h-[30px] w-[147px]`}>
      <div className="absolute left-[2px] top-[1px]">
        <Avatar />
      </div>
      <span className="absolute left-[31px] top-[2px] font-jersey15 text-[14px] leading-[14px] text-white">
        Roronoa Zoro
      </span>
      <span className="absolute left-[31px] top-[16px] font-jersey10 text-[8px] leading-[9px] text-[#cbcbcb]">
        roronoa.zoro23@spit.ac.in
      </span>
      <span aria-hidden className="absolute left-[131px] top-[9px] flex flex-col gap-[1px]">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="h-[3px] w-[3px] rounded-full bg-white" />
        ))}
      </span>
    </div>
  )
}

function HeaderActions() {
  return (
    <div className="pointer-events-auto absolute right-[17px] top-[17px] flex h-[30px] items-center">
      <span className="flex h-[30px] w-[72px] items-center justify-center rounded-[5px] bg-[#0083D5] font-jersey25 text-[14px] leading-[14px] text-white">
        Invite
      </span>
      <div className="ml-[9px] flex gap-[2px]">
        {[0, 1, 2, 3].map((slot) => (
          <span key={slot} className={`${HUD_SURFACE} h-[30px] w-[30px]`} />
        ))}
      </div>
      <div className="ml-[11px]">
        <ProfileChip />
      </div>
      <span className={`${HUD_SURFACE} ml-[11px] flex h-[30px] w-[30px] items-center justify-center`}>
        <Settings size={21} strokeWidth={1.8} className="text-[#797979]" aria-label="Settings" />
      </span>
    </div>
  )
}

export function ModelSelector() {
  return (
    <div
      title="Only the Point Cloud view is available in this build"
      aria-disabled
      className={`${HUD_SURFACE} pointer-events-auto absolute left-[12px] top-[61px] h-[23px] w-[149px] cursor-default`}
    >
      <span
        className={`${HUD_SURFACE} absolute left-[3px] top-[2px] flex h-[17px] w-[114px] items-center pl-[6px] font-jersey10 text-[12px] leading-[13px] text-white`}
      >
        Point Cloud Model
      </span>
      <span className={`${HUD_SURFACE} absolute left-[124px] top-[2px] flex h-[17px] w-[20px] items-center justify-center`}>
        <span className="border-x-[5.5px] border-t-[6px] border-x-transparent border-t-white" />
      </span>
    </div>
  )
}

export function AnalyticsBar() {
  return (
    <div className={`${HUD_SURFACE} pointer-events-auto absolute right-[11px] top-[64px] h-[23px] w-[286px]`}>
      <span className="absolute left-[24px] top-[4px] font-jersey10 text-[12px] leading-[13px] text-white">
        Overall Analytics
      </span>
      <span className="absolute left-[204px] top-[4px] font-jersey10 text-[12px] leading-[13px] text-white">
        Today
      </span>
      <Calendar size={13} strokeWidth={1.7} className="absolute left-[232px] top-[4px] text-[#8b8b8b]" />
      <span className={`${HUD_SURFACE} absolute left-[259px] top-[2px] flex h-[17px] w-[20px] items-center justify-center`}>
        <PanelRight size={13} strokeWidth={1.8} className="text-white" />
      </span>
    </div>
  )
}

export default function TopBar() {
  return (
    <>
      <div className="absolute left-[23px] top-[12px]">
        <BrandLogo />
      </div>
      <span className="absolute left-[73px] top-[25px] font-jersey25 text-[20px] leading-[20px] text-white">
        AIRLOCK++
      </span>
      <MenuBar />
      <HeaderActions />
      <ModelSelector />
      <AnalyticsBar />
    </>
  )
}
