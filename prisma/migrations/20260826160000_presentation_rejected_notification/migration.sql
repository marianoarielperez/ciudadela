-- El aviso al socio de que la Comisión NO aceptó su re-empadronamiento.
-- Aditiva: sólo suma un valor al enum, ninguna fila existente cambia.
-- AlterTable
ALTER TABLE `notifications`
    MODIFY `type` ENUM('email_verification', 'password_invitation', 'application_result', 'reregistration_first', 'reregistration_second', 'withdrawal_declared', 'fee_reminder', 'arrears_alert', 'receipt', 'payment_rejected', 'request_accepted', 'request_rejected', 'board_digest', 'presentation_received', 'presentation_observed', 'presentation_rejected', 'generic') NOT NULL;
