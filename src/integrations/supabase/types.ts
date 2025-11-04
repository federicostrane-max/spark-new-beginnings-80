export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      agent_config: {
        Row: {
          agent_id: string
          custom_system_prompt: string | null
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          custom_system_prompt?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          custom_system_prompt?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_config_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          agent_id: string
          created_at: string | null
          id: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_document_links: {
        Row: {
          agent_id: string
          assigned_by: string | null
          assignment_type: string
          confidence_score: number | null
          created_at: string | null
          document_id: string
          id: string
        }
        Insert: {
          agent_id: string
          assigned_by?: string | null
          assignment_type: string
          confidence_score?: number | null
          created_at?: string | null
          document_id: string
          id?: string
        }
        Update: {
          agent_id?: string
          assigned_by?: string | null
          assignment_type?: string
          confidence_score?: number | null
          created_at?: string | null
          document_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_document_links_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_knowledge: {
        Row: {
          agent_id: string | null
          category: string
          content: string
          created_at: string | null
          document_name: string
          embedding: string | null
          id: string
          pool_document_id: string | null
          source_type: string | null
          summary: string | null
        }
        Insert: {
          agent_id?: string | null
          category: string
          content: string
          created_at?: string | null
          document_name: string
          embedding?: string | null
          id?: string
          pool_document_id?: string | null
          source_type?: string | null
          summary?: string | null
        }
        Update: {
          agent_id?: string | null
          category?: string
          content?: string
          created_at?: string | null
          document_name?: string
          embedding?: string | null
          id?: string
          pool_document_id?: string | null
          source_type?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_knowledge_pool_document_id_fkey"
            columns: ["pool_document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_message_attachments: {
        Row: {
          created_at: string | null
          extracted_text: string | null
          file_name: string
          file_type: string
          id: string
          message_id: string
          public_url: string
        }
        Insert: {
          created_at?: string | null
          extracted_text?: string | null
          file_name: string
          file_type: string
          id?: string
          message_id: string
          public_url: string
        }
        Update: {
          created_at?: string | null
          extracted_text?: string | null
          file_name?: string
          file_type?: string
          id?: string
          message_id?: string
          public_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          active: boolean | null
          avatar: string | null
          created_at: string | null
          description: string
          id: string
          llm_provider: string | null
          name: string
          slug: string
          system_prompt: string
          user_id: string | null
        }
        Insert: {
          active?: boolean | null
          avatar?: string | null
          created_at?: string | null
          description: string
          id?: string
          llm_provider?: string | null
          name: string
          slug: string
          system_prompt: string
          user_id?: string | null
        }
        Update: {
          active?: boolean | null
          avatar?: string | null
          created_at?: string | null
          description?: string
          id?: string
          llm_provider?: string | null
          name?: string
          slug?: string
          system_prompt?: string
          user_id?: string | null
        }
        Relationships: []
      }
      document_processing_cache: {
        Row: {
          created_at: string | null
          document_id: string
          error_message: string | null
          id: string
          processed_chunks: number | null
          processing_completed_at: string | null
          processing_started_at: string | null
          retry_count: number | null
          total_chunks: number | null
          updated_at: string | null
          validation_completed_at: string | null
          validation_started_at: string | null
        }
        Insert: {
          created_at?: string | null
          document_id: string
          error_message?: string | null
          id?: string
          processed_chunks?: number | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          retry_count?: number | null
          total_chunks?: number | null
          updated_at?: string | null
          validation_completed_at?: string | null
          validation_started_at?: string | null
        }
        Update: {
          created_at?: string | null
          document_id?: string
          error_message?: string | null
          id?: string
          processed_chunks?: number | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          retry_count?: number | null
          total_chunks?: number | null
          updated_at?: string | null
          validation_completed_at?: string | null
          validation_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_cache_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      inter_agent_messages: {
        Row: {
          answer: string
          consulted_agent_id: string
          context_conversation_id: string | null
          created_at: string | null
          id: string
          question: string
          requesting_agent_id: string
        }
        Insert: {
          answer: string
          consulted_agent_id: string
          context_conversation_id?: string | null
          created_at?: string | null
          id?: string
          question: string
          requesting_agent_id: string
        }
        Update: {
          answer?: string
          consulted_agent_id?: string
          context_conversation_id?: string | null
          created_at?: string | null
          id?: string
          question?: string
          requesting_agent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inter_agent_messages_consulted_agent_id_fkey"
            columns: ["consulted_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inter_agent_messages_context_conversation_id_fkey"
            columns: ["context_conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inter_agent_messages_requesting_agent_id_fkey"
            columns: ["requesting_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          ai_summary: string | null
          complexity_level: string | null
          created_at: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          keywords: string[] | null
          processed_at: string | null
          processing_status: string
          search_query: string | null
          source_url: string | null
          text_length: number | null
          topics: string[] | null
          updated_at: string | null
          validation_date: string | null
          validation_reason: string | null
          validation_status: string
        }
        Insert: {
          ai_summary?: string | null
          complexity_level?: string | null
          created_at?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          keywords?: string[] | null
          processed_at?: string | null
          processing_status?: string
          search_query?: string | null
          source_url?: string | null
          text_length?: number | null
          topics?: string[] | null
          updated_at?: string | null
          validation_date?: string | null
          validation_reason?: string | null
          validation_status?: string
        }
        Update: {
          ai_summary?: string | null
          complexity_level?: string | null
          created_at?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          keywords?: string[] | null
          processed_at?: string | null
          processing_status?: string
          search_query?: string | null
          source_url?: string | null
          text_length?: number | null
          topics?: string[] | null
          updated_at?: string | null
          validation_date?: string | null
          validation_reason?: string | null
          validation_status?: string
        }
        Relationships: []
      }
      pdf_exports: {
        Row: {
          conversations_count: number | null
          created_at: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          messages_count: number | null
          public_url: string
          user_id: string
        }
        Insert: {
          conversations_count?: number | null
          created_at?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          messages_count?: number | null
          public_url: string
          user_id: string
        }
        Update: {
          conversations_count?: number | null
          created_at?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          messages_count?: number | null
          public_url?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_distinct_documents: {
        Args: { p_agent_id: string }
        Returns: {
          category: string
          created_at: string
          document_name: string
          id: string
          summary: string
        }[]
      }
      get_or_create_conversation: {
        Args: { p_agent_id: string; p_user_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_documents: {
        Args: {
          filter_agent_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          content: string
          document_name: string
          id: string
          similarity: number
          summary: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
