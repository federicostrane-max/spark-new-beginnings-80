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
      agent_alerts: {
        Row: {
          action_type: string | null
          action_url: string | null
          agent_id: string | null
          alert_type: string
          created_at: string | null
          details: Json | null
          dismissed: boolean | null
          dismissed_at: string | null
          expires_at: string | null
          id: string
          is_read: boolean | null
          message: string
          operation_log_id: string | null
          read_at: string | null
          severity: string
          title: string
          user_id: string | null
        }
        Insert: {
          action_type?: string | null
          action_url?: string | null
          agent_id?: string | null
          alert_type: string
          created_at?: string | null
          details?: Json | null
          dismissed?: boolean | null
          dismissed_at?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          operation_log_id?: string | null
          read_at?: string | null
          severity?: string
          title: string
          user_id?: string | null
        }
        Update: {
          action_type?: string | null
          action_url?: string | null
          agent_id?: string | null
          alert_type?: string
          created_at?: string | null
          details?: Json | null
          dismissed?: boolean | null
          dismissed_at?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          operation_log_id?: string | null
          read_at?: string | null
          severity?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_alerts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_alerts_operation_log_id_fkey"
            columns: ["operation_log_id"]
            isOneToOne: false
            referencedRelation: "agent_operation_logs"
            referencedColumns: ["id"]
          },
        ]
      }
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
          sync_completed_at: string | null
          sync_error: string | null
          sync_started_at: string | null
          sync_status: string | null
        }
        Insert: {
          agent_id: string
          assigned_by?: string | null
          assignment_type: string
          confidence_score?: number | null
          created_at?: string | null
          document_id: string
          id?: string
          sync_completed_at?: string | null
          sync_error?: string | null
          sync_started_at?: string | null
          sync_status?: string | null
        }
        Update: {
          agent_id?: string
          assigned_by?: string | null
          assignment_type?: string
          confidence_score?: number | null
          created_at?: string | null
          document_id?: string
          id?: string
          sync_completed_at?: string | null
          sync_error?: string | null
          sync_started_at?: string | null
          sync_status?: string | null
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
          is_active: boolean
          pool_document_id: string | null
          removal_reason: string | null
          removed_at: string | null
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
          is_active?: boolean
          pool_document_id?: string | null
          removal_reason?: string | null
          removed_at?: string | null
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
          is_active?: boolean
          pool_document_id?: string | null
          removal_reason?: string | null
          removed_at?: string | null
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
          llm_provider: string | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          llm_provider?: string | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          llm_provider?: string | null
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
      agent_operation_logs: {
        Row: {
          agent_id: string
          agent_name: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string | null
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          error_stack: string | null
          id: string
          input_data: Json | null
          metrics: Json | null
          operation_type: string
          output_data: Json | null
          started_at: string
          status: string
          triggered_by: string | null
          user_id: string | null
          validation_details: Json | null
          validation_status: string | null
        }
        Insert: {
          agent_id: string
          agent_name: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          input_data?: Json | null
          metrics?: Json | null
          operation_type: string
          output_data?: Json | null
          started_at?: string
          status?: string
          triggered_by?: string | null
          user_id?: string | null
          validation_details?: Json | null
          validation_status?: string | null
        }
        Update: {
          agent_id?: string
          agent_name?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          input_data?: Json | null
          metrics?: Json | null
          operation_type?: string
          output_data?: Json | null
          started_at?: string
          status?: string
          triggered_by?: string | null
          user_id?: string | null
          validation_details?: Json | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_operation_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_prompt_history: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          id: string
          system_prompt: string
          version_number: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          system_prompt: string
          version_number?: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          system_prompt?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_prompt_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_task_requirements: {
        Row: {
          agent_id: string
          core_concepts: Json
          created_at: string
          decision_patterns: Json
          domain_vocabulary: Json
          extracted_at: string
          extraction_model: string
          id: string
          procedural_knowledge: Json
          system_prompt_hash: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          core_concepts?: Json
          created_at?: string
          decision_patterns?: Json
          domain_vocabulary?: Json
          extracted_at?: string
          extraction_model?: string
          id?: string
          procedural_knowledge?: Json
          system_prompt_hash: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          core_concepts?: Json
          created_at?: string
          decision_patterns?: Json
          domain_vocabulary?: Json
          extracted_at?: string
          extraction_model?: string
          id?: string
          procedural_knowledge?: Json
          system_prompt_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_task_requirements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
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
          first_alignment_completed_at: string | null
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
          first_alignment_completed_at?: string | null
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
          first_alignment_completed_at?: string | null
          id?: string
          llm_provider?: string | null
          name?: string
          slug?: string
          system_prompt?: string
          user_id?: string | null
        }
        Relationships: []
      }
      alignment_analysis_log: {
        Row: {
          agent_id: string
          chunks_auto_removed: number
          chunks_flagged_for_removal: number
          completed_at: string | null
          concept_coverage_percentage: number | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          identified_gaps: Json | null
          safe_mode_active: boolean
          started_at: string
          surplus_categories: Json | null
          total_chunks_analyzed: number
          trigger_type: string
        }
        Insert: {
          agent_id: string
          chunks_auto_removed?: number
          chunks_flagged_for_removal: number
          completed_at?: string | null
          concept_coverage_percentage?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          identified_gaps?: Json | null
          safe_mode_active?: boolean
          started_at?: string
          surplus_categories?: Json | null
          total_chunks_analyzed: number
          trigger_type: string
        }
        Update: {
          agent_id?: string
          chunks_auto_removed?: number
          chunks_flagged_for_removal?: number
          completed_at?: string | null
          concept_coverage_percentage?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          identified_gaps?: Json | null
          safe_mode_active?: boolean
          started_at?: string
          surplus_categories?: Json | null
          total_chunks_analyzed?: number
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alignment_analysis_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
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
      inter_agent_logs: {
        Row: {
          completed_at: string | null
          consulted_agent_id: string
          consulted_conversation_id: string
          created_at: string | null
          error_message: string | null
          id: string
          initiated_at: string | null
          metadata: Json | null
          requesting_agent_id: string
          requesting_conversation_id: string
          status: string
          task_description: string
        }
        Insert: {
          completed_at?: string | null
          consulted_agent_id: string
          consulted_conversation_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          initiated_at?: string | null
          metadata?: Json | null
          requesting_agent_id: string
          requesting_conversation_id: string
          status: string
          task_description: string
        }
        Update: {
          completed_at?: string | null
          consulted_agent_id?: string
          consulted_conversation_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          initiated_at?: string | null
          metadata?: Json | null
          requesting_agent_id?: string
          requesting_conversation_id?: string
          status?: string
          task_description?: string
        }
        Relationships: [
          {
            foreignKeyName: "inter_agent_logs_consulted_agent_id_fkey"
            columns: ["consulted_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inter_agent_logs_consulted_conversation_id_fkey"
            columns: ["consulted_conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inter_agent_logs_requesting_agent_id_fkey"
            columns: ["requesting_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inter_agent_logs_requesting_conversation_id_fkey"
            columns: ["requesting_conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
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
      knowledge_relevance_scores: {
        Row: {
          agent_id: string
          analysis_model: string
          analysis_reasoning: string | null
          analyzed_at: string
          chunk_id: string
          concept_coverage: number
          created_at: string
          final_relevance_score: number
          id: string
          procedural_match: number
          requirement_id: string
          semantic_relevance: number
          vocabulary_alignment: number
        }
        Insert: {
          agent_id: string
          analysis_model?: string
          analysis_reasoning?: string | null
          analyzed_at?: string
          chunk_id: string
          concept_coverage: number
          created_at?: string
          final_relevance_score: number
          id?: string
          procedural_match: number
          requirement_id: string
          semantic_relevance: number
          vocabulary_alignment: number
        }
        Update: {
          agent_id?: string
          analysis_model?: string
          analysis_reasoning?: string | null
          analyzed_at?: string
          chunk_id?: string
          concept_coverage?: number
          created_at?: string
          final_relevance_score?: number
          id?: string
          procedural_match?: number
          requirement_id?: string
          semantic_relevance?: number
          vocabulary_alignment?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_relevance_scores_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_relevance_scores_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "agent_knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_relevance_scores_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "agent_task_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_removal_history: {
        Row: {
          agent_id: string
          category: string
          chunk_id: string
          content: string
          created_at: string
          document_name: string
          embedding: string | null
          final_relevance_score: number | null
          id: string
          pool_document_id: string | null
          removal_reason: string
          removal_type: string
          removed_at: string
          restoration_user_id: string | null
          restored_at: string | null
          source_type: string | null
          summary: string | null
        }
        Insert: {
          agent_id: string
          category: string
          chunk_id: string
          content: string
          created_at?: string
          document_name: string
          embedding?: string | null
          final_relevance_score?: number | null
          id?: string
          pool_document_id?: string | null
          removal_reason: string
          removal_type: string
          removed_at?: string
          restoration_user_id?: string | null
          restored_at?: string | null
          source_type?: string | null
          summary?: string | null
        }
        Update: {
          agent_id?: string
          category?: string
          chunk_id?: string
          content?: string
          created_at?: string
          document_name?: string
          embedding?: string | null
          final_relevance_score?: number | null
          id?: string
          pool_document_id?: string | null
          removal_reason?: string
          removal_type?: string
          removed_at?: string
          restoration_user_id?: string | null
          restored_at?: string | null
          source_type?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_removal_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_removal_history_pool_document_id_fkey"
            columns: ["pool_document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_execution_logs: {
        Row: {
          agents_sync_failed: number | null
          agents_synced: number | null
          chunks_cleaned: number | null
          created_at: string | null
          details: Json | null
          documents_failed: number | null
          documents_fixed: number | null
          error_message: string | null
          execution_completed_at: string | null
          execution_started_at: string
          execution_status: string
          id: string
        }
        Insert: {
          agents_sync_failed?: number | null
          agents_synced?: number | null
          chunks_cleaned?: number | null
          created_at?: string | null
          details?: Json | null
          documents_failed?: number | null
          documents_fixed?: number | null
          error_message?: string | null
          execution_completed_at?: string | null
          execution_started_at?: string
          execution_status?: string
          id?: string
        }
        Update: {
          agents_sync_failed?: number | null
          agents_synced?: number | null
          chunks_cleaned?: number | null
          created_at?: string | null
          details?: Json | null
          documents_failed?: number | null
          documents_fixed?: number | null
          error_message?: string | null
          execution_completed_at?: string | null
          execution_started_at?: string
          execution_status?: string
          id?: string
        }
        Relationships: []
      }
      maintenance_operation_details: {
        Row: {
          attempt_number: number | null
          created_at: string | null
          error_message: string | null
          execution_log_id: string
          id: string
          operation_type: string
          status: string
          target_id: string
          target_name: string
        }
        Insert: {
          attempt_number?: number | null
          created_at?: string | null
          error_message?: string | null
          execution_log_id: string
          id?: string
          operation_type: string
          status: string
          target_id: string
          target_name: string
        }
        Update: {
          attempt_number?: number | null
          created_at?: string | null
          error_message?: string | null
          execution_log_id?: string
          id?: string
          operation_type?: string
          status?: string
          target_id?: string
          target_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_operation_details_execution_log_id_fkey"
            columns: ["execution_log_id"]
            isOneToOne: false
            referencedRelation: "maintenance_execution_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_download_queue: {
        Row: {
          agent_id: string
          completed_at: string | null
          conversation_id: string
          created_at: string | null
          document_id: string | null
          download_attempts: number | null
          downloaded_file_name: string | null
          error_message: string | null
          expected_author: string | null
          expected_title: string
          id: string
          search_query: string
          source: string | null
          started_at: string | null
          status: string
          url: string
          validation_result: Json | null
          year: string | null
        }
        Insert: {
          agent_id: string
          completed_at?: string | null
          conversation_id: string
          created_at?: string | null
          document_id?: string | null
          download_attempts?: number | null
          downloaded_file_name?: string | null
          error_message?: string | null
          expected_author?: string | null
          expected_title: string
          id?: string
          search_query: string
          source?: string | null
          started_at?: string | null
          status?: string
          url: string
          validation_result?: Json | null
          year?: string | null
        }
        Update: {
          agent_id?: string
          completed_at?: string | null
          conversation_id?: string
          created_at?: string | null
          document_id?: string | null
          download_attempts?: number | null
          downloaded_file_name?: string | null
          error_message?: string | null
          expected_author?: string | null
          expected_title?: string
          id?: string
          search_query?: string
          source?: string | null
          started_at?: string | null
          status?: string
          url?: string
          validation_result?: Json | null
          year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_download_queue_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_download_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_download_queue_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
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
      search_results_cache: {
        Row: {
          authors: string | null
          conversation_id: string
          created_at: string | null
          credibility_score: number | null
          file_size_bytes: number | null
          id: string
          result_number: number
          source: string | null
          source_type: string | null
          title: string
          url: string
          verified: boolean | null
          year: string | null
        }
        Insert: {
          authors?: string | null
          conversation_id: string
          created_at?: string | null
          credibility_score?: number | null
          file_size_bytes?: number | null
          id?: string
          result_number: number
          source?: string | null
          source_type?: string | null
          title: string
          url: string
          verified?: boolean | null
          year?: string | null
        }
        Update: {
          authors?: string | null
          conversation_id?: string
          created_at?: string | null
          credibility_score?: number | null
          file_size_bytes?: number | null
          id?: string
          result_number?: number
          source?: string | null
          source_type?: string | null
          title?: string
          url?: string
          verified?: boolean | null
          year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_results_cache_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
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
      count_processing_documents: { Args: never; Returns: number }
      find_orphaned_chunks: {
        Args: never
        Returns: {
          agent_id: string
          chunk_id: string
          document_name: string
          pool_document_id: string
        }[]
      }
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
      log_operation_complete: {
        Args: {
          p_error_code?: string
          p_error_message?: string
          p_error_stack?: string
          p_log_id: string
          p_metrics?: Json
          p_output_data?: Json
          p_status: string
          p_validation_details?: Json
          p_validation_status?: string
        }
        Returns: undefined
      }
      log_operation_start: {
        Args: {
          p_agent_id: string
          p_correlation_id?: string
          p_input_data?: Json
          p_operation_type: string
          p_triggered_by?: string
          p_user_id?: string
        }
        Returns: string
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
          pool_document_id: string
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
