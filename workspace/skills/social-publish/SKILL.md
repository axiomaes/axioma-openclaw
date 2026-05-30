# Skill: Social Publish

## Description
Publica de forma automatizada contenido y copys generados en los canales de redes sociales de Axioma Creativa (LinkedIn e Instagram) utilizando las APIs oficiales correspondientes y los tokens de acceso del entorno.

## Inputs
- `platform`: Plataforma de destino ("linkedin" | "instagram").
- `content`: El copy o texto en markdown del post a publicar.
- `imageUrl`: (Opcional) URL de una imagen a adjuntar (necesario para Instagram y recomendado para LinkedIn).

## Outputs
- `status`: success/failed.
- `postId`: Identificador único de la publicación en la red social correspondiente.
- `error`: Detalle del error en caso de fallo.
