import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Aperture,
  FileJson2,
  Gauge,
  MapPin,
  Radio,
  Video,
} from 'lucide-react'

export type SurveyInputId =
  | 'video'
  | 'gps'
  | 'metadata'
  | 'imu'
  | 'baro'
  | 'intrinsics'
  | 'rtk'

export interface SurveyInputSpec {
  id: SurveyInputId
  title: string
  description: string
  required: boolean
  /** Lower-case extensions without the dot. */
  extensions: string[]
  icon: LucideIcon
}

/**
 * Inputs for the Generate Model workflow. The frontend only checks the file
 * extension; real content validation belongs to the backend.
 */
export const SURVEY_INPUTS: SurveyInputSpec[] = [
  {
    id: 'video',
    title: 'Drone Video',
    description: 'Survey flight footage — MP4, MOV or AVI.',
    required: true,
    extensions: ['mp4', 'mov', 'avi'],
    icon: Video,
  },
  {
    id: 'gps',
    title: 'GPS Coordinates',
    description: 'Flight trajectory — CSV, GPX, KML or SRT.',
    required: true,
    extensions: ['csv', 'gpx', 'kml', 'srt'],
    icon: MapPin,
  },
  {
    id: 'metadata',
    title: 'Flight Metadata',
    description: 'Flight and mission information — JSON, XML, CSV or TXT.',
    required: true,
    extensions: ['json', 'xml', 'csv', 'txt'],
    icon: FileJson2,
  },
  {
    id: 'imu',
    title: 'IMU Data',
    description: 'Orientation and motion log — CSV, TXT or JSON.',
    required: false,
    extensions: ['csv', 'txt', 'json'],
    icon: Activity,
  },
  {
    id: 'baro',
    title: 'Barometric Altitude',
    description: 'Pressure-altitude log — CSV, TXT or JSON.',
    required: false,
    extensions: ['csv', 'txt', 'json'],
    icon: Gauge,
  },
  {
    id: 'intrinsics',
    title: 'Camera Intrinsic Parameters',
    description: 'Calibration parameters — JSON, XML, YAML or TXT.',
    required: false,
    extensions: ['json', 'xml', 'yaml', 'yml', 'txt'],
    icon: Aperture,
  },
  {
    id: 'rtk',
    title: 'RTK / PPK Corrections',
    description: 'Positioning corrections — POS, OBS, NAV, CSV or TXT.',
    required: false,
    extensions: ['pos', 'obs', 'nav', 'csv', 'txt'],
    icon: Radio,
  },
]

export const REQUIRED_INPUTS = SURVEY_INPUTS.filter((i) => i.required)
export const OPTIONAL_INPUTS = SURVEY_INPUTS.filter((i) => !i.required)

export type SurveyFiles = Partial<Record<SurveyInputId, File>>
