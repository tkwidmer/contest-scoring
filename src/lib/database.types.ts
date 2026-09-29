
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "categories": {
                  Row: {
                    "contest_id": string,"created_at": string,"drop_rank": number | null,"id": string,"name": string,"sort": number
                  }
                  Insert: {
                    "contest_id": string,"created_at"?: string,"drop_rank"?: number | null,"id"?: string,"name": string,"sort"?: number
                  }
                  Update: {
                    "contest_id"?: string,"created_at"?: string,"drop_rank"?: number | null,"id"?: string,"name"?: string,"sort"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_contest_id_fkey"
      columns: ["contest_id"]
isOneToOne: false
      referencedRelation: "contests"
      referencedColumns: ["id"]
    }
                  ]
                },"components": {
                  Row: {
                    "category_id": string,"created_at": string,"description": string | null,"id": string,"max_points": number,"min_points": number,"name": string,"sort": number,"step": number
                  }
                  Insert: {
                    "category_id": string,"created_at"?: string,"description"?: string | null,"id"?: string,"max_points": number,"min_points"?: number,"name": string,"sort"?: number,"step"?: number
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"max_points"?: number,"min_points"?: number,"name"?: string,"sort"?: number,"step"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "components_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"contestant_contacts": {
                  Row: {
                    "contestant_id": string,"email": string
                  }
                  Insert: {
                    "contestant_id": string,"email": string
                  }
                  Update: {
                    "contestant_id"?: string,"email"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contestant_contacts_contestant_id_fkey"
      columns: ["contestant_id"]
isOneToOne: true
      referencedRelation: "contestants"
      referencedColumns: ["id"]
    }
                  ]
                },"contestants": {
                  Row: {
                    "contest_id": string,"created_at": string,"display_name": string,"id": string,"number": number | null,"represents": string | null,"sort": number,"withdrawn": boolean
                  }
                  Insert: {
                    "contest_id": string,"created_at"?: string,"display_name": string,"id"?: string,"number"?: number | null,"represents"?: string | null,"sort"?: number,"withdrawn"?: boolean
                  }
                  Update: {
                    "contest_id"?: string,"created_at"?: string,"display_name"?: string,"id"?: string,"number"?: number | null,"represents"?: string | null,"sort"?: number,"withdrawn"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "contestants_contest_id_fkey"
      columns: ["contest_id"]
isOneToOne: false
      referencedRelation: "contests"
      referencedColumns: ["id"]
    }
                  ]
                },"contests": {
                  Row: {
                    "aggregation": string,"anonymize_comments": boolean,"created_at": string,"event_id": string,"final_result": Json | null,"finalized_at": string | null,"id": string,"manual_winner_contestant_id": string | null,"manual_winner_reason": string | null,"name": string,"org_id": string,"status": string,"threshold_pct": number | null
                  }
                  Insert: {
                    "aggregation"?: string,"anonymize_comments"?: boolean,"created_at"?: string,"event_id": string,"final_result"?: Json | null,"finalized_at"?: string | null,"id"?: string,"manual_winner_contestant_id"?: string | null,"manual_winner_reason"?: string | null,"name": string,"org_id": string,"status"?: string,"threshold_pct"?: number | null
                  }
                  Update: {
                    "aggregation"?: string,"anonymize_comments"?: boolean,"created_at"?: string,"event_id"?: string,"final_result"?: Json | null,"finalized_at"?: string | null,"id"?: string,"manual_winner_contestant_id"?: string | null,"manual_winner_reason"?: string | null,"name"?: string,"org_id"?: string,"status"?: string,"threshold_pct"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contests_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contests_manual_winner_contestant_id_fkey"
      columns: ["manual_winner_contestant_id"]
isOneToOne: false
      referencedRelation: "contestants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string,"starts_on": string | null,"venue": string | null
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string,"starts_on"?: string | null,"venue"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"starts_on"?: string | null,"venue"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"judges": {
                  Row: {
                    "contest_id": string,"created_at": string,"email": string | null,"id": string,"name": string,"sort": number,"user_id": string | null
                  }
                  Insert: {
                    "contest_id": string,"created_at"?: string,"email"?: string | null,"id"?: string,"name": string,"sort"?: number,"user_id"?: string | null
                  }
                  Update: {
                    "contest_id"?: string,"created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string,"sort"?: number,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "judges_contest_id_fkey"
      columns: ["contest_id"]
isOneToOne: false
      referencedRelation: "contests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "judges_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"org_members": {
                  Row: {
                    "created_at": string,"org_id": string,"role": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"org_id": string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"org_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"orgs": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"id": string,"is_platform_admin": boolean
                  }
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"id": string,"is_platform_admin"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string,"is_platform_admin"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"recusals": {
                  Row: {
                    "contestant_id": string,"judge_id": string,"reason": string | null
                  }
                  Insert: {
                    "contestant_id": string,"judge_id": string,"reason"?: string | null
                  }
                  Update: {
                    "contestant_id"?: string,"judge_id"?: string,"reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "recusals_contestant_id_fkey"
      columns: ["contestant_id"]
isOneToOne: false
      referencedRelation: "contestants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recusals_judge_id_fkey"
      columns: ["judge_id"]
isOneToOne: false
      referencedRelation: "judges"
      referencedColumns: ["id"]
    }
                  ]
                },"score_audit": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"component_id": string,"contest_id": string,"contestant_id": string,"id": number,"judge_id": string,"new_value": number | null,"old_value": number | null,"op": string,"score_id": string
                  }
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"component_id": string,"contest_id": string,"contestant_id": string,"id"?: never,"judge_id": string,"new_value"?: number | null,"old_value"?: number | null,"op": string,"score_id": string
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"component_id"?: string,"contest_id"?: string,"contestant_id"?: string,"id"?: never,"judge_id"?: string,"new_value"?: number | null,"old_value"?: number | null,"op"?: string,"score_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "score_audit_contest_id_fkey"
      columns: ["contest_id"]
isOneToOne: false
      referencedRelation: "contests"
      referencedColumns: ["id"]
    }
                  ]
                },"scores": {
                  Row: {
                    "component_id": string,"contest_id": string,"contestant_id": string,"entered_by": string | null,"id": string,"judge_id": string,"updated_at": string,"value": number
                  }
                  Insert: {
                    "component_id": string,"contest_id": string,"contestant_id": string,"entered_by"?: string | null,"id"?: string,"judge_id": string,"updated_at"?: string,"value": number
                  }
                  Update: {
                    "component_id"?: string,"contest_id"?: string,"contestant_id"?: string,"entered_by"?: string | null,"id"?: string,"judge_id"?: string,"updated_at"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "scores_component_id_fkey"
      columns: ["component_id"]
isOneToOne: false
      referencedRelation: "components"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scores_contest_id_fkey"
      columns: ["contest_id"]
isOneToOne: false
      referencedRelation: "contests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scores_contestant_id_fkey"
      columns: ["contestant_id"]
isOneToOne: false
      referencedRelation: "contestants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scores_entered_by_fkey"
      columns: ["entered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scores_judge_id_fkey"
      columns: ["judge_id"]
isOneToOne: false
      referencedRelation: "judges"
      referencedColumns: ["id"]
    }
                  ]
                },"tiebreak_steps": {
                  Row: {
                    "category_ids": (string)[],"contest_id": string,"step_no": number
                  }
                  Insert: {
                    "category_ids": (string)[],"contest_id": string,"step_no": number
                  }
                  Update: {
                    "category_ids"?: (string)[],"contest_id"?: string,"step_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "tiebreak_steps_contest_id_fkey"
      columns: ["contest_id"]
isOneToOne: false
      referencedRelation: "contests"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "create_org":
{ Args: { "p_name": string }; Returns: string
                           },
"finalize_contest":
{ Args: { "p_contest": string,"p_result": Json }; Returns: undefined
                           },
"set_contest_status":
{ Args: { "p_contest": string,"p_status": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const

