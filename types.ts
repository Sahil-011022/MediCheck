
export enum UserRole {
  PATIENT = 'PATIENT',
  DOCTOR = 'DOCTOR',
  CLINIC = 'CLINIC'
}

export interface MedicalProfile {
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  allergies?: string;
  chronicConditions?: string;
}

export interface ClinicDetails {
  facilities: string[];
  staff: string[];
  images: string[]; // base64
  location: string;
  description: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
  phoneNumber?: string;
  specialization?: string; // For Doctors
  education?: string;      // For Doctors
  experience?: number;     // For Doctors (Years)
  hospital?: string;       // For Doctors (Primary Hospital)
  smallClinics?: string[]; // For Doctors (List of other clinics)
  medicalProfile?: MedicalProfile;
  clinicDetails?: ClinicDetails;
}

export type ConnectionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface ConnectionRequest {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  status: ConnectionStatus;
  timestamp: any;
  fromRole: UserRole;
  toRole?: UserRole;
  memberTag?: string; // e.g., 'Doctor', 'Nurse', 'Owner', 'Admin'
}

export interface SymptomReport {
  id: string;
  patientId: string;
  patientName: string;
  symptoms: string;
  analysis: string;
  possibleConditions: string[];
  urgency: 'Low' | 'Medium' | 'High' | 'Critical';
  timestamp: number;
  readBy?: string[];
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicName: string;
  date: string;
  time: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  reason: string;
  timestamp: any;
}

export interface DoctorMessage {
  id: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  content: string;
  timestamp: any;
  reportId?: string;
  read: boolean;
}

export interface PharmacyLocation {
  name: string;
  address: string;
  uri: string;
}
