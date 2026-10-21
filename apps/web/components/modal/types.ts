// Types for Modal and related components

export interface App {
  id: string;
  name: string;
  icon: string;
  /** Exact action types this app groups, derived from @repo/actions. */
  types?: string[];
  /** Trigger-app rule: match every type that starts with this. */
  prefix?: string;
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
