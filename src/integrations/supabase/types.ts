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
          last_proposed_query: string | null
          title: string | null
          updated_at: string | null
          user_id: string
          waiting_for_confirmation: boolean | null
          workflow_updated_at: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          id?: string
          last_proposed_query?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
          waiting_for_confirmation?: boolean | null
          workflow_updated_at?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          id?: string
          last_proposed_query?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
          waiting_for_confirmation?: boolean | null
          workflow_updated_at?: string | null
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
      agent_knowledge: {
        Row: {
          agent_id: string | null
          category: string
          chunk_type: string | null
          chunking_metadata: Json | null
          content: string
          created_at: string | null
          document_name: string
          embedding: string | null
          id: string
          is_active: boolean
          pool_document_id: string | null
          removal_reason: string | null
          removed_at: string | null
          summary: string | null
        }
        Insert: {
          agent_id?: string | null
          category: string
          chunk_type?: string | null
          chunking_metadata?: Json | null
          content: string
          created_at?: string | null
          document_name: string
          embedding?: string | null
          id?: string
          is_active?: boolean
          pool_document_id?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          summary?: string | null
        }
        Update: {
          agent_id?: string | null
          category?: string
          chunk_type?: string | null
          chunking_metadata?: Json | null
          content?: string
          created_at?: string | null
          document_name?: string
          embedding?: string | null
          id?: string
          is_active?: boolean
          pool_document_id?: string | null
          removal_reason?: string | null
          removed_at?: string | null
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
          metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          llm_provider?: string | null
          metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          llm_provider?: string | null
          metadata?: Json | null
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
          agent_id: string | null
          bibliographic_references: Json
          created_at: string | null
          domain_vocabulary: string[]
          explicit_rules: string[]
          extracted_at: string | null
          extraction_model: string
          filter_prompt_id: string | null
          id: string
          operational_concepts: string[]
          procedural_knowledge: string[]
          system_prompt_hash: string
          theoretical_concepts: string[]
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          bibliographic_references?: Json
          created_at?: string | null
          domain_vocabulary?: string[]
          explicit_rules?: string[]
          extracted_at?: string | null
          extraction_model: string
          filter_prompt_id?: string | null
          id?: string
          operational_concepts?: string[]
          procedural_knowledge?: string[]
          system_prompt_hash: string
          theoretical_concepts?: string[]
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          bibliographic_references?: Json
          created_at?: string | null
          domain_vocabulary?: string[]
          explicit_rules?: string[]
          extracted_at?: string | null
          extraction_model?: string
          filter_prompt_id?: string | null
          id?: string
          operational_concepts?: string[]
          procedural_knowledge?: string[]
          system_prompt_hash?: string
          theoretical_concepts?: string[]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_task_requirements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_task_requirements_filter_prompt_id_fkey"
            columns: ["filter_prompt_id"]
            isOneToOne: false
            referencedRelation: "filter_agent_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          active: boolean | null
          ai_model: string | null
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
          ai_model?: string | null
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
          ai_model?: string | null
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
      alignment_agent_prompts: {
        Row: {
          agent_type: string
          alignment_version: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          llm_model: string | null
          notes: string | null
          prompt_content: string
          version_number: number
        }
        Insert: {
          agent_type?: string
          alignment_version?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          llm_model?: string | null
          notes?: string | null
          prompt_content: string
          version_number: number
        }
        Update: {
          agent_type?: string
          alignment_version?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          llm_model?: string | null
          notes?: string | null
          prompt_content?: string
          version_number?: number
        }
        Relationships: []
      }
      alignment_analysis_log: {
        Row: {
          actual_chunks_scored: number | null
          agent_id: string | null
          analysis_config: Json | null
          chunks_auto_removed: number
          chunks_flagged_for_removal: number
          chunks_kept: number | null
          chunks_removed: number | null
          completed_at: string | null
          created_at: string | null
          dimension_breakdown: Json | null
          duration_ms: number | null
          execution_id: string | null
          id: string
          integrity_message: string | null
          integrity_valid: boolean | null
          missing_critical_sources: Json | null
          overall_alignment_percentage: number | null
          prerequisite_check_passed: boolean
          requirement_id: string | null
          started_at: string
          total_chunks_analyzed: number
        }
        Insert: {
          actual_chunks_scored?: number | null
          agent_id?: string | null
          analysis_config?: Json | null
          chunks_auto_removed?: number
          chunks_flagged_for_removal?: number
          chunks_kept?: number | null
          chunks_removed?: number | null
          completed_at?: string | null
          created_at?: string | null
          dimension_breakdown?: Json | null
          duration_ms?: number | null
          execution_id?: string | null
          id?: string
          integrity_message?: string | null
          integrity_valid?: boolean | null
          missing_critical_sources?: Json | null
          overall_alignment_percentage?: number | null
          prerequisite_check_passed: boolean
          requirement_id?: string | null
          started_at?: string
          total_chunks_analyzed?: number
        }
        Update: {
          actual_chunks_scored?: number | null
          agent_id?: string | null
          analysis_config?: Json | null
          chunks_auto_removed?: number
          chunks_flagged_for_removal?: number
          chunks_kept?: number | null
          chunks_removed?: number | null
          completed_at?: string | null
          created_at?: string | null
          dimension_breakdown?: Json | null
          duration_ms?: number | null
          execution_id?: string | null
          id?: string
          integrity_message?: string | null
          integrity_valid?: boolean | null
          missing_critical_sources?: Json | null
          overall_alignment_percentage?: number | null
          prerequisite_check_passed?: boolean
          requirement_id?: string | null
          started_at?: string
          total_chunks_analyzed?: number
        }
        Relationships: [
          {
            foreignKeyName: "alignment_analysis_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alignment_analysis_log_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "agent_task_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      alignment_analysis_progress: {
        Row: {
          agent_id: string
          chunks_processed: number | null
          current_batch: number | null
          error_message: string | null
          id: string
          partial_results: Json | null
          requirement_id: string | null
          started_at: string | null
          status: string | null
          total_chunks: number
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          chunks_processed?: number | null
          current_batch?: number | null
          error_message?: string | null
          id?: string
          partial_results?: Json | null
          requirement_id?: string | null
          started_at?: string | null
          status?: string | null
          total_chunks: number
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          chunks_processed?: number | null
          current_batch?: number | null
          error_message?: string | null
          id?: string
          partial_results?: Json | null
          requirement_id?: string | null
          started_at?: string | null
          status?: string | null
          total_chunks?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alignment_analysis_progress_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alignment_analysis_progress_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "agent_task_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_datasets: {
        Row: {
          created_at: string | null
          document_id: string | null
          file_name: string
          ground_truth: string
          id: string
          is_active: boolean | null
          provisioned_at: string | null
          question: string
          question_language: string | null
          source_metadata: Json | null
          source_repo: string | null
          storage_path: string | null
          suite_category: string
        }
        Insert: {
          created_at?: string | null
          document_id?: string | null
          file_name: string
          ground_truth: string
          id?: string
          is_active?: boolean | null
          provisioned_at?: string | null
          question: string
          question_language?: string | null
          source_metadata?: Json | null
          source_repo?: string | null
          storage_path?: string | null
          suite_category: string
        }
        Update: {
          created_at?: string | null
          document_id?: string | null
          file_name?: string
          ground_truth?: string
          id?: string
          is_active?: boolean | null
          provisioned_at?: string | null
          question?: string
          question_language?: string | null
          source_metadata?: Json | null
          source_repo?: string | null
          storage_path?: string | null
          suite_category?: string
        }
        Relationships: []
      }
      benchmark_results: {
        Row: {
          agent_response: string | null
          correct: boolean | null
          created_at: string | null
          error: string | null
          ground_truth: string
          id: string
          pdf_file: string
          question: string
          reason: string | null
          response_time_ms: number | null
          retrieval_metadata: Json | null
          run_id: string
          status: string
          suite_category: string | null
        }
        Insert: {
          agent_response?: string | null
          correct?: boolean | null
          created_at?: string | null
          error?: string | null
          ground_truth: string
          id?: string
          pdf_file: string
          question: string
          reason?: string | null
          response_time_ms?: number | null
          retrieval_metadata?: Json | null
          run_id: string
          status: string
          suite_category?: string | null
        }
        Update: {
          agent_response?: string | null
          correct?: boolean | null
          created_at?: string | null
          error?: string | null
          ground_truth?: string
          id?: string
          pdf_file?: string
          question?: string
          reason?: string | null
          response_time_ms?: number | null
          retrieval_metadata?: Json | null
          run_id?: string
          status?: string
          suite_category?: string | null
        }
        Relationships: []
      }
      benchmark_suites: {
        Row: {
          capabilities: Json | null
          created_at: string | null
          description: string | null
          name: string
          slug: string
          source_type: string | null
          source_url: string | null
          target_personas: Json | null
        }
        Insert: {
          capabilities?: Json | null
          created_at?: string | null
          description?: string | null
          name: string
          slug: string
          source_type?: string | null
          source_url?: string | null
          target_personas?: Json | null
        }
        Update: {
          capabilities?: Json | null
          created_at?: string | null
          description?: string | null
          name?: string
          slug?: string
          source_type?: string | null
          source_url?: string | null
          target_personas?: Json | null
        }
        Relationships: []
      }
      edge_function_execution_logs: {
        Row: {
          agent_id: string | null
          created_at: string
          execution_id: string
          function_name: string
          id: string
          log_level: string
          message: string
          metadata: Json | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          execution_id: string
          function_name: string
          id?: string
          log_level: string
          message: string
          metadata?: Json | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          execution_id?: string
          function_name?: string
          id?: string
          log_level?: string
          message?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "edge_function_execution_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      filter_agent_prompts: {
        Row: {
          created_at: string | null
          created_by: string | null
          filter_version: string | null
          id: string
          is_active: boolean | null
          llm_model: string | null
          notes: string | null
          prompt_content: string
          version_number: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          filter_version?: string | null
          id?: string
          is_active?: boolean | null
          llm_model?: string | null
          notes?: string | null
          prompt_content: string
          version_number?: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          filter_version?: string | null
          id?: string
          is_active?: boolean | null
          llm_model?: string | null
          notes?: string | null
          prompt_content?: string
          version_number?: number
        }
        Relationships: []
      }
      folders: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          parent_folder: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          parent_folder?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          parent_folder?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      github_import_progress: {
        Row: {
          completed_at: string | null
          created_at: string | null
          downloaded: number | null
          error_message: string | null
          failed: number | null
          folder: string
          id: string
          processed: number | null
          repo: string
          started_at: string | null
          status: string | null
          total_files: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          downloaded?: number | null
          error_message?: string | null
          failed?: number | null
          folder: string
          id?: string
          processed?: number | null
          repo: string
          started_at?: string | null
          status?: string | null
          total_files?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          downloaded?: number | null
          error_message?: string | null
          failed?: number | null
          folder?: string
          id?: string
          processed?: number | null
          repo?: string
          started_at?: string | null
          status?: string | null
          total_files?: number | null
        }
        Relationships: []
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
      knowledge_relevance_scores: {
        Row: {
          agent_id: string | null
          analysis_model: string
          analysis_reasoning: string | null
          analyzed_at: string | null
          bibliographic_match: number
          chunk_id: string | null
          concept_coverage: number
          final_relevance_score: number
          id: string
          procedural_match: number
          requirement_id: string | null
          semantic_relevance: number
          vocabulary_alignment: number
          weights_used: Json | null
        }
        Insert: {
          agent_id?: string | null
          analysis_model: string
          analysis_reasoning?: string | null
          analyzed_at?: string | null
          bibliographic_match: number
          chunk_id?: string | null
          concept_coverage: number
          final_relevance_score: number
          id?: string
          procedural_match: number
          requirement_id?: string | null
          semantic_relevance: number
          vocabulary_alignment: number
          weights_used?: Json | null
        }
        Update: {
          agent_id?: string | null
          analysis_model?: string
          analysis_reasoning?: string | null
          analyzed_at?: string | null
          bibliographic_match?: number
          chunk_id?: string | null
          concept_coverage?: number
          final_relevance_score?: number
          id?: string
          procedural_match?: number
          requirement_id?: string | null
          semantic_relevance?: number
          vocabulary_alignment?: number
          weights_used?: Json | null
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
        ]
      }
      llamaparse_debug_logs: {
        Row: {
          bbox_format: string | null
          created_at: string | null
          document_name: string
          element_types_found: string[] | null
          has_bounding_boxes: boolean | null
          has_reading_order: boolean | null
          id: string
          image_format: string | null
          images_info: Json | null
          parse_settings: Json
          raw_json_output: Json | null
          total_elements: number | null
        }
        Insert: {
          bbox_format?: string | null
          created_at?: string | null
          document_name: string
          element_types_found?: string[] | null
          has_bounding_boxes?: boolean | null
          has_reading_order?: boolean | null
          id?: string
          image_format?: string | null
          images_info?: Json | null
          parse_settings: Json
          raw_json_output?: Json | null
          total_elements?: number | null
        }
        Update: {
          bbox_format?: string | null
          created_at?: string | null
          document_name?: string
          element_types_found?: string[] | null
          has_bounding_boxes?: boolean | null
          has_reading_order?: boolean | null
          id?: string
          image_format?: string | null
          images_info?: Json | null
          parse_settings?: Json
          raw_json_output?: Json | null
          total_elements?: number | null
        }
        Relationships: []
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
      pipeline_a_agent_knowledge: {
        Row: {
          agent_id: string
          chunk_id: string
          id: string
          is_active: boolean | null
          synced_at: string | null
        }
        Insert: {
          agent_id: string
          chunk_id: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Update: {
          agent_id?: string
          chunk_id?: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_a_agent_knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_a_agent_knowledge_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "pipeline_a_chunks_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_a_chunks_raw: {
        Row: {
          chunk_index: number
          chunk_type: string | null
          content: string
          created_at: string | null
          document_id: string
          embedded_at: string | null
          embedding: string | null
          embedding_error: string | null
          embedding_status: string | null
          heading_hierarchy: Json | null
          id: string
          is_atomic: boolean | null
          original_content: string | null
          page_number: number | null
          summary: string | null
        }
        Insert: {
          chunk_index: number
          chunk_type?: string | null
          content: string
          created_at?: string | null
          document_id: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string | null
          heading_hierarchy?: Json | null
          id?: string
          is_atomic?: boolean | null
          original_content?: string | null
          page_number?: number | null
          summary?: string | null
        }
        Update: {
          chunk_index?: number
          chunk_type?: string | null
          content?: string
          created_at?: string | null
          document_id?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string | null
          heading_hierarchy?: Json | null
          id?: string
          is_atomic?: boolean | null
          original_content?: string | null
          page_number?: number | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_a_chunks_raw_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "pipeline_a_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_a_documents: {
        Row: {
          created_at: string | null
          error_message: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          folder: string | null
          full_text: string | null
          id: string
          llamaparse_job_id: string | null
          page_count: number | null
          processed_at: string | null
          processing_metadata: Json | null
          repo_path: string | null
          repo_url: string | null
          source_type: string | null
          status: string | null
          storage_bucket: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          folder?: string | null
          full_text?: string | null
          id?: string
          llamaparse_job_id?: string | null
          page_count?: number | null
          processed_at?: string | null
          processing_metadata?: Json | null
          repo_path?: string | null
          repo_url?: string | null
          source_type?: string | null
          status?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          folder?: string | null
          full_text?: string | null
          id?: string
          llamaparse_job_id?: string | null
          page_count?: number | null
          processed_at?: string | null
          processing_metadata?: Json | null
          repo_path?: string | null
          repo_url?: string | null
          source_type?: string | null
          status?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_a_hybrid_agent_knowledge: {
        Row: {
          agent_id: string
          chunk_id: string
          id: string
          is_active: boolean | null
          synced_at: string | null
        }
        Insert: {
          agent_id: string
          chunk_id: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Update: {
          agent_id?: string
          chunk_id?: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_a_hybrid_agent_knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_a_hybrid_agent_knowledge_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "pipeline_a_hybrid_chunks_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_a_hybrid_chunks_raw: {
        Row: {
          batch_index: number | null
          chunk_index: number
          chunk_type: string | null
          content: string
          created_at: string | null
          document_id: string
          embedded_at: string | null
          embedding: string | null
          embedding_error: string | null
          embedding_status: string | null
          heading_hierarchy: Json | null
          id: string
          is_atomic: boolean | null
          original_content: string | null
          page_number: number | null
          summary: string | null
        }
        Insert: {
          batch_index?: number | null
          chunk_index: number
          chunk_type?: string | null
          content: string
          created_at?: string | null
          document_id: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string | null
          heading_hierarchy?: Json | null
          id?: string
          is_atomic?: boolean | null
          original_content?: string | null
          page_number?: number | null
          summary?: string | null
        }
        Update: {
          batch_index?: number | null
          chunk_index?: number
          chunk_type?: string | null
          content?: string
          created_at?: string | null
          document_id?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string | null
          heading_hierarchy?: Json | null
          id?: string
          is_atomic?: boolean | null
          original_content?: string | null
          page_number?: number | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_a_hybrid_chunks_raw_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "pipeline_a_hybrid_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_a_hybrid_documents: {
        Row: {
          created_at: string | null
          error_message: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          folder: string | null
          id: string
          llamaparse_job_id: string | null
          page_count: number | null
          processed_at: string | null
          processing_metadata: Json | null
          source_type: string | null
          status: string | null
          storage_bucket: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          folder?: string | null
          id?: string
          llamaparse_job_id?: string | null
          page_count?: number | null
          processed_at?: string | null
          processing_metadata?: Json | null
          source_type?: string | null
          status?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          folder?: string | null
          id?: string
          llamaparse_job_id?: string | null
          page_count?: number | null
          processed_at?: string | null
          processing_metadata?: Json | null
          source_type?: string | null
          status?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_b_agent_knowledge: {
        Row: {
          agent_id: string
          chunk_id: string
          id: string
          is_active: boolean | null
          synced_at: string | null
        }
        Insert: {
          agent_id: string
          chunk_id: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Update: {
          agent_id?: string
          chunk_id?: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_b_agent_knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_b_agent_knowledge_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "pipeline_b_chunks_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_b_chunks_raw: {
        Row: {
          chunk_id: string | null
          chunk_index: number
          chunk_type: string
          content: string
          created_at: string | null
          document_id: string
          embedded_at: string | null
          embedding: string | null
          embedding_error: string | null
          embedding_status: string
          id: string
          page_number: number | null
          visual_grounding: Json | null
        }
        Insert: {
          chunk_id?: string | null
          chunk_index: number
          chunk_type?: string
          content: string
          created_at?: string | null
          document_id: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string
          id?: string
          page_number?: number | null
          visual_grounding?: Json | null
        }
        Update: {
          chunk_id?: string | null
          chunk_index?: number
          chunk_type?: string
          content?: string
          created_at?: string | null
          document_id?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string
          id?: string
          page_number?: number | null
          visual_grounding?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_b_chunks_raw_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "pipeline_b_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_b_documents: {
        Row: {
          created_at: string | null
          error_message: string | null
          file_name: string
          file_path: string | null
          file_size_bytes: number | null
          folder: string | null
          full_text: string | null
          id: string
          page_count: number | null
          processed_at: string | null
          repo_path: string | null
          repo_url: string | null
          source_type: string
          status: string
          storage_bucket: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          file_name: string
          file_path?: string | null
          file_size_bytes?: number | null
          folder?: string | null
          full_text?: string | null
          id?: string
          page_count?: number | null
          processed_at?: string | null
          repo_path?: string | null
          repo_url?: string | null
          source_type: string
          status?: string
          storage_bucket?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          file_name?: string
          file_path?: string | null
          file_size_bytes?: number | null
          folder?: string | null
          full_text?: string | null
          id?: string
          page_count?: number | null
          processed_at?: string | null
          repo_path?: string | null
          repo_url?: string | null
          source_type?: string
          status?: string
          storage_bucket?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_c_agent_knowledge: {
        Row: {
          agent_id: string
          chunk_id: string
          id: string
          is_active: boolean | null
          synced_at: string | null
        }
        Insert: {
          agent_id: string
          chunk_id: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Update: {
          agent_id?: string
          chunk_id?: string
          id?: string
          is_active?: boolean | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_c_agent_knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_c_agent_knowledge_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "pipeline_c_chunks_raw"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_c_chunks_raw: {
        Row: {
          chunk_index: number
          chunk_type: string
          content: string
          created_at: string | null
          document_id: string
          document_section: string | null
          embedded_at: string | null
          embedding: string | null
          embedding_error: string | null
          embedding_status: string | null
          headings: Json | null
          id: string
          keywords: string[] | null
          page_number: number | null
          position: string | null
          semantic_weight: number | null
          visual_grounding: Json | null
        }
        Insert: {
          chunk_index: number
          chunk_type: string
          content: string
          created_at?: string | null
          document_id: string
          document_section?: string | null
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string | null
          headings?: Json | null
          id?: string
          keywords?: string[] | null
          page_number?: number | null
          position?: string | null
          semantic_weight?: number | null
          visual_grounding?: Json | null
        }
        Update: {
          chunk_index?: number
          chunk_type?: string
          content?: string
          created_at?: string | null
          document_id?: string
          document_section?: string | null
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_status?: string | null
          headings?: Json | null
          id?: string
          keywords?: string[] | null
          page_number?: number | null
          position?: string | null
          semantic_weight?: number | null
          visual_grounding?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_c_chunks_raw_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "pipeline_c_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_c_documents: {
        Row: {
          created_at: string | null
          error_message: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          folder: string | null
          id: string
          page_count: number | null
          processed_at: string | null
          status: string
          storage_bucket: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          folder?: string | null
          id?: string
          page_count?: number | null
          processed_at?: string | null
          status?: string
          storage_bucket?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          folder?: string | null
          id?: string
          page_count?: number | null
          processed_at?: string | null
          status?: string
          storage_bucket?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      prerequisite_checks: {
        Row: {
          agent_id: string | null
          check_passed: boolean
          checked_at: string | null
          created_at: string | null
          critical_sources_found: Json | null
          id: string
          missing_critical_sources: Json | null
          requirement_id: string | null
        }
        Insert: {
          agent_id?: string | null
          check_passed: boolean
          checked_at?: string | null
          created_at?: string | null
          critical_sources_found?: Json | null
          id?: string
          missing_critical_sources?: Json | null
          requirement_id?: string | null
        }
        Update: {
          agent_id?: string | null
          check_passed?: boolean
          checked_at?: string | null
          created_at?: string | null
          critical_sources_found?: Json | null
          id?: string
          missing_critical_sources?: Json | null
          requirement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prerequisite_checks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prerequisite_checks_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "agent_task_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          batch_index: number
          chunks_created: number | null
          completed_at: string | null
          created_at: string | null
          document_id: string
          error_message: string | null
          id: string
          input_file_path: string
          page_end: number
          page_start: number
          status: string
          total_batches: number
        }
        Insert: {
          batch_index: number
          chunks_created?: number | null
          completed_at?: string | null
          created_at?: string | null
          document_id: string
          error_message?: string | null
          id?: string
          input_file_path: string
          page_end: number
          page_start: number
          status?: string
          total_batches: number
        }
        Update: {
          batch_index?: number
          chunks_created?: number | null
          completed_at?: string | null
          created_at?: string | null
          document_id?: string
          error_message?: string | null
          id?: string
          input_file_path?: string
          page_end?: number
          page_start?: number
          status?: string
          total_batches?: number
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "pipeline_a_hybrid_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      search_query_history: {
        Row: {
          agent_id: string
          conversation_id: string
          created_at: string
          executed_query: string
          id: string
          original_topic: string
          pdfs_downloaded: number | null
          pdfs_failed: number | null
          query_variant_index: number
          results_found: number | null
        }
        Insert: {
          agent_id: string
          conversation_id: string
          created_at?: string
          executed_query: string
          id?: string
          original_topic: string
          pdfs_downloaded?: number | null
          pdfs_failed?: number | null
          query_variant_index: number
          results_found?: number | null
        }
        Update: {
          agent_id?: string
          conversation_id?: string
          created_at?: string
          executed_query?: string
          id?: string
          original_topic?: string
          pdfs_downloaded?: number | null
          pdfs_failed?: number | null
          query_variant_index?: number
          results_found?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "search_query_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_query_history_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
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
      visual_enrichment_queue: {
        Row: {
          chunk_id: string | null
          created_at: string
          document_id: string
          enrichment_text: string | null
          error_message: string | null
          id: string
          image_base64: string | null
          image_metadata: Json | null
          processed_at: string | null
          status: string
          storage_path: string | null
        }
        Insert: {
          chunk_id?: string | null
          created_at?: string
          document_id: string
          enrichment_text?: string | null
          error_message?: string | null
          id?: string
          image_base64?: string | null
          image_metadata?: Json | null
          processed_at?: string | null
          status?: string
          storage_path?: string | null
        }
        Update: {
          chunk_id?: string | null
          created_at?: string
          document_id?: string
          enrichment_text?: string | null
          error_message?: string | null
          id?: string
          image_base64?: string | null
          image_metadata?: Json | null
          processed_at?: string | null
          status?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visual_enrichment_queue_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "pipeline_a_hybrid_chunks_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visual_enrichment_queue_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "pipeline_a_hybrid_documents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_alignment_prompt: {
        Args: { prompt_id: string }
        Returns: undefined
      }
      activate_filter_prompt: {
        Args: { prompt_id: string }
        Returns: undefined
      }
      cleanup_orphaned_document_links: {
        Args: never
        Returns: {
          agent_id: string
          deleted_link_id: string
          document_id: string
        }[]
      }
      count_documents_without_chunks: { Args: never; Returns: number }
      count_processing_documents: { Args: never; Returns: number }
      get_agent_sync_status: {
        Args: { p_agent_id: string }
        Returns: {
          chunk_count: number
          document_id: string
          document_name: string
          pipeline_source: string
          sync_status: string
        }[]
      }
      get_distinct_documents: {
        Args: { p_agent_id: string }
        Returns: {
          category: string
          created_at: string
          document_name: string
          id: string
          pool_document_id: string
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
      keyword_search_documents: {
        Args: { match_count?: number; p_agent_id: string; search_query: string }
        Returns: {
          category: string
          chunk_type: string
          content: string
          document_name: string
          id: string
          pipeline_source: string
          similarity: number
        }[]
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
          match_count?: number
          match_threshold?: number
          p_agent_id: string
          query_embedding: string
        }
        Returns: {
          category: string
          chunk_type: string
          content: string
          document_name: string
          id: string
          pipeline_source: string
          similarity: number
        }[]
      }
      recategorize_github_documents: { Args: never; Returns: number }
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
