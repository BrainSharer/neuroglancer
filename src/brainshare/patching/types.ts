// types.ts
import { Operation } from "fast-json-patch";

interface ChangeResult {
    seq: string;
    id: string;
    changes: { rev: string }[];
    deleted?: boolean;
}

export interface ChangesFeed {
    results: ChangeResult[];
    last_seq: string;
    pending: number;
}

export interface CouchDbChange {
    seq: string;
    id: string;
    changes: { rev: string }[];
    deleted?: boolean;
    doc?: any; // This needs to be very generic
}

export interface CouchUserDocument {
    _id: string;          // Unique document ID
    _rev?: string;        // Revision token, optional for new docs
    _deleted?: boolean;   // If true, marks the document as deleted
    users: any;
}

export interface ListenOptions {
    dbUrl: string;
    docId: string;
    since?: string; // Optional: start listening from a specific sequence
    onChange: (change: CouchDbChange) => void;
    onError?: (error: any) => void;
}

export interface BaseDoc {
    _id: string;
    _rev?: string;
    type: "base";
    version: number;
    data: any;
}

export interface PatchDoc {
    _id: string;
    _rev?: string;
    type: "patch";
    stateID: string;
    version: number;
    patch: Operation[];
    timestamp: number;
}

export interface State {
    id: number;
    user: string;
    owner: number;
    animal: string;
    comments: string;
    neuroglancer_state: object;
    readonly: boolean;
    public: boolean;
    lab: string;
}

export interface User {
    id: number;
    username: string;
    lab: string;
    access: string;
}
