export interface State {
    id: number;
    owner: number;
    comments: string;
    user_date: string;
    neuroglancer_state: Record<string, unknown>;
    readonly: boolean;
    lab: string;
}
