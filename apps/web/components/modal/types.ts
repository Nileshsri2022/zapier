// Types for Modal and related components

export interface App {
  id: string;
  name: string;
  icon: string;
  prefix?: string;
  exact?: string;
  category?: string; // 'apps' (default) or 'flow-controls'
}

export interface AvailableItem {
  id: string;
  type: string;
  image: string;
}

export interface Server {
  id: string;
  email?: string;
  botUsername?: string;
  botName?: string;
  displayName?: string;
  name?: string;
}

export interface MetaDataFormProps {
  handleClick: (data: any) => void;
}

export interface MetaDataWithTypeProps extends MetaDataFormProps {
  selectedType: string;
  preSelectedServerId?: string;
}
