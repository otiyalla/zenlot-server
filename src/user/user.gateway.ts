import { ConnectedSocket, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';


@WebSocketGateway(
  {
    cors: {
      origin: ['http://localhost:8081', 'https://zenlot.com'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    namespace: 'user',
  }
)
export class UserGateway {
  @WebSocketServer()
  server: Server;


  /*
  @SubscribeMessage('update-user')
  async handleMessage(@ConnectedSocket() client: Socket, payload: {}): Promise<{}> {
    return this.server.emit('updated-user', payload)
  }*/
}
