export interface State {
    state_id: number;
    owner_id: number;
    comments: string;
    user_date: string;
    neuroglancer_state: Record<string, unknown>;
    readonly: boolean;
    lab: string;
}
